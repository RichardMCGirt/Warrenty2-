import React, { useState, useEffect } from 'react';
import './App.css';
import { useSession, useSupabaseClient, useSessionContext } from '@supabase/auth-helpers-react';
let isTerminated = false; // Initialize the variable early in the file

async function processEvents(events, calendarId, session) {
  if (!session || !session.provider_token) {
    console.error('Session or provider token is missing.');
    return;
  }

  for (const event of events) {
    try {
      // Lock the event in Airtable
      await lockAirtableRecord(event.id);

      // Check if an event already exists in Google Calendar
      const googleEventId = await checkForDuplicateEvent(event, calendarId, session);

      if (googleEventId) {
        // Fetch the existing Google Calendar event
        const googleEvent = await getGoogleCalendarEvent(googleEventId, calendarId, session);

        if (isEventDifferent(event, googleEvent)) {
          // If the event has changed, delete the old one and create a new one
          await deleteGoogleCalendarEvent(googleEventId, calendarId, session);
          const newGoogleEventId = await createGoogleCalendarEvent(event, calendarId, session);
          await updateAirtableWithGoogleEventIdAndProcessed(event.id, newGoogleEventId, true);
        } else {
          console.log(`Event "${event.title}" has no changes.`);
        }
      } else {
        // If the event doesn't exist in Google Calendar, create it
        const newGoogleEventId = await createGoogleCalendarEvent(event, calendarId, session);
        if (newGoogleEventId) {
          await updateAirtableWithGoogleEventIdAndProcessed(event.id, newGoogleEventId, true);
        }
      }

      // Unlock the event in Airtable
      await unlockAirtableRecord(event.id);
    } catch (error) {
      console.error(`Error processing event "${event.title}":`, error);
      // Make sure the record is unlocked in case of an error
      await unlockAirtableRecord(event.id);
    }
  }
}

async function syncGoogleCalendarWithAirtable(calendarId, session) {
  console.log('Synchronizing Google Calendar with Airtable...');

  // Fetch all events from Google Calendar
  const googleEvents = await fetchAllGoogleCalendarEvents(calendarId, session);
  if (!googleEvents || googleEvents.length === 0) {
    console.log('No events found in Google Calendar.');
    return;
  }

  // Fetch all records from Airtable, including processed ones
  const airtableEvents = await fetchAllAirtableEvents();

  const processedEvents = [];

  for (const airtableEvent of airtableEvents) {
    const googleEvent = googleEvents.find(event => event.id === airtableEvent.googleEventId);

    if (googleEvent) {
      // Compare Google Calendar event with Airtable record
      if (isEventDifferent(airtableEvent, googleEvent)) {
        console.log(`Differences found in event "${airtableEvent.title}". Deleting Google Calendar event and marking Airtable as unprocessed.`);

        // Delete the Google Calendar event
        await deleteGoogleCalendarEvent(googleEvent.id, calendarId, session);

        // Mark the Airtable record as unprocessed and remove GoogleEventId
        await markAirtableRecordAsUnprocessed(airtableEvent.id);
      } else {
        processedEvents.push(airtableEvent.id);
      }
    } else if (airtableEvent.googleEventId) {
      // The event exists in Airtable but not in Google Calendar, mark it as unprocessed
      console.log(`Google Calendar event not found for Airtable record "${airtableEvent.title}". Marking as unprocessed.`);
      await markAirtableRecordAsUnprocessed(airtableEvent.id);
    }
  }

  console.log(`Google Calendar and Airtable synchronization completed. ${processedEvents.length} records are in sync.`);
}

// Fetch all Airtable records, including processed ones
async function fetchAllAirtableEvents() {
  console.log('Fetching all Airtable events...');
  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ?fields[]=GoogleEventId&fields[]=Calendar Event Name&fields[]=StartDate&fields[]=EndDate&fields[]=Street Address&fields[]=City&fields[]=State&fields[]=Zip Code&fields[]=Homeowner Name&fields[]=Processed`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    return data.records.map(record => ({
      id: record.id,
      title: record.fields['Calendar Event Name'] || 'Untitled Event',
      start: new Date(record.fields['StartDate']),
      end: new Date(record.fields['EndDate']),
      googleEventId: record.fields['GoogleEventId'],
      processed: record.fields['Processed'] || false,
      streetAddress: record.fields['Street Address'] || '',
      city: record.fields['City'] || '',
      state: record.fields['State'] || '',
      zipCode: record.fields['Zip Code'] || '',
      homeownerName: record.fields['Homeowner Name'] || '',
    }));
  } catch (error) {
    console.error('Error fetching Airtable events:', error);
    return [];
  }
}

// Mark Airtable record as unprocessed
async function markAirtableRecordAsUnprocessed(airtableRecordId) {
  console.log(`Marking Airtable record ${airtableRecordId} as unprocessed and removing GoogleEventId...`);

  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ/${airtableRecordId}`;
  const updateData = {
    fields: {
      GoogleEventId: null,
      Processed: false,
    },
  };

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updateData),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Error updating Airtable record:', data.error);
    } else {
      console.log('Airtable record successfully marked as unprocessed:', data);
    }
  } catch (error) {
    console.error('Error updating Airtable record:', error);
  }
}


async function deleteDuplicateGoogleCalendarEvents(calendarId, session) {
  if (!session || !session.provider_token) {
    console.error('Session or provider token is not available.');
    return;
  }

  console.log("Checking for duplicate events in Google Calendar...");

  // Fetch all GoogleEventIds from Airtable
  const airtableGoogleEventIds = await fetchGoogleEventIdsFromAirtable();

  const allEvents = await fetchAllGoogleCalendarEvents(calendarId, session);

  if (!allEvents || allEvents.length === 0) {
    console.log("No events found in Google Calendar.");
    return;
  }

  const seenEvents = new Map(); // Track unique events
  const duplicates = []; // Track duplicate event IDs

  for (const event of allEvents) {
    const title = event.summary ? event.summary.trim().toLowerCase() : 'unknown';
    const startTime = event.start?.dateTime || event.start?.date || 'unknown';

    // Normalize time for comparison
    const normalizeTime = (date) => {
      const roundedDate = new Date(date);
      roundedDate.setSeconds(0, 0); // Round to the nearest minute
      return roundedDate.toISOString();
    };

    const uniqueKey = `${title}|${normalizeTime(startTime)}`;

    // Log event data for debugging
    console.log(`Event: ${title}, Start: ${startTime}, Unique Key: ${uniqueKey}`);

    // Check if the event has already been seen
    if (seenEvents.has(uniqueKey)) {
      const existingEventId = seenEvents.get(uniqueKey);
      
      // If the GoogleEventId is the same, it's likely a duplicate
      if (airtableGoogleEventIds.has(event.id) || airtableGoogleEventIds.has(existingEventId)) {
        // Skip deleting the original, but mark the rest as duplicates
        if (!duplicates.includes(existingEventId)) {
          duplicates.push(event.id); // Add duplicate event ID to the list
        }
      } else {
        seenEvents.set(uniqueKey, event.id); // Mark event as seen
      }
    } else {
      seenEvents.set(uniqueKey, event.id); // Mark event as seen
    }
  }

  if (duplicates.length > 0) {
    console.log(`Found ${duplicates.length} duplicate events in Google Calendar. Deleting...`);
    await batchDeleteGoogleCalendarEvents(duplicates, calendarId, session);
  } else {
    console.log("No duplicate events found in Google Calendar.");
  }
}


// Fetch all GoogleEventId from Airtable
async function fetchGoogleEventIdsFromAirtable() {
  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ?fields[]=GoogleEventId`;
  const airtableGoogleEventIds = new Set();

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    // Loop through records and collect all GoogleEventIds
    for (const record of data.records) {
      if (record.fields.GoogleEventId) {
        airtableGoogleEventIds.add(record.fields.GoogleEventId);
      }
    }
  } catch (error) {
    console.error('Error fetching GoogleEventIds from Airtable:', error);
  }

  return airtableGoogleEventIds;
}

async function batchDeleteGoogleCalendarEvents(eventIds, calendarId, session, batchSize = 10) {
  for (let i = 0; i < eventIds.length; i += batchSize) {
    const batch = eventIds.slice(i, i + batchSize);

    try {
      for (const eventId of batch) {
        const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`;

        const response = await fetch(url, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${session.provider_token}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          const data = await response.json();
          console.error(`Error deleting event ${eventId}:`, data);
        } else {
          console.log(`Successfully deleted event ${eventId}`);
        }
      }
    } catch (error) {
      console.error('Error during batch delete of Google Calendar events:', error);
    }
  }
}

async function fetchAllGoogleCalendarEvents(calendarId, session) {
  let allEvents = [];
  let nextPageToken = null;

  // Set timeMin to a very early date to fetch all past, present, and future events
  const timeMin = '1970-01-01T00:00:00Z';  // January 1, 1970, often used as a base date in computing

  try {
    do {
      const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?timeMin=${timeMin}&maxResults=2500${nextPageToken ? `&pageToken=${nextPageToken}` : ''}`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${session.provider_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const data = await response.json();
        console.error('Error fetching Google Calendar events:', data);
        return [];
      }

      const data = await response.json();
      allEvents = allEvents.concat(data.items);

      nextPageToken = data.nextPageToken; // Get the next page token, if available
    } while (nextPageToken);

    return allEvents;
  } catch (error) {
    console.error("Error fetching all Google Calendar events:", error);
    return [];
  }
}


function terminateScript() {
  isTerminated = true;
  console.log("Terminating all processes.");
  clearAllTimers();
}

if (typeof isTerminated !== 'undefined' && isTerminated) {
  console.log("Script is terminated. Skipping further actions.");
}


async function createGoogleCalendarEvent(event, calendarId, session) {
  // Final check to ensure the event doesn't already exist in Google Calendar
  let googleEventId = await checkForDuplicateEvent(event, calendarId, session);
  
  if (googleEventId) {
    console.log(`Duplicate event found. Skipping creation for "${event.title}".`);
    return; // Skip event creation if a duplicate exists
  }

  console.log(`Creating new Google Calendar event for "${event.title}"...`);

  // Construct the event description with additional fields
  let eventDescription = `Homeowner: ${event.homeownerName}\n`;
  if (event.billable) {
    eventDescription += `Billable: Yes\nRepair Charge: $${event.repairChargeAmount}\nReason: ${event.billableReason}\n`;
  } else {
    eventDescription += `Billable: No\n`;
  }
  eventDescription += event.description.trim();  // Append the regular description if available

  // Map Airtable fields to Google Calendar event fields
  const updatedEvent = {
    summary: event.title,
    description: eventDescription,  // Updated description with new fields
    start: { dateTime: event.start.toISOString() },
    end: { dateTime: event.end.toISOString() },
    location: `${event.streetAddress}, ${event.city}, ${event.state}, ${event.zipCode}`,
  };

  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.provider_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatedEvent),
    });

    const data = await response.json();
    if (response.ok) {
      console.log('Event created successfully with ID:', data.id);
      return data.id;
    } else {
      console.error('Failed to create event:', data);
      return null;
    }
  } catch (error) {
    console.error('Error during Google Calendar API request:', error);
    return null;
  }
}





async function updateAirtableWithGoogleEventIdAndProcessed(airtableRecordId, googleEventId, hasChanges) {
  if (!hasChanges) {
    console.log(`No changes found for record ${airtableRecordId}. Skipping update.`);
    return; // Exit the function if no changes are found
  }

  console.log(`Updating Airtable record ${airtableRecordId} with Google Event ID: ${googleEventId} and marking as processed`);

  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ/${airtableRecordId}`;
  const updateData = {
    fields: {
      GoogleEventId: googleEventId,
      Processed: true, // Mark the record as processed to avoid duplicate syncs
      LastUpdated: new Date().toISOString(),
    },
  };

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updateData),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Error updating Airtable:', data.error);
    } else {
      console.log('Airtable record successfully updated:', data);
    }
  } catch (error) {
    console.error('Error updating Airtable:', error);
  }
}


async function lockAirtableRecord(airtableRecordId) {
  console.log(`Locking Airtable record ${airtableRecordId}`);
  
  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ/${airtableRecordId}`;
  const updateData = { fields: { Processed: true } };

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updateData),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error(`Error locking record ${airtableRecordId}:`, data);
    } else {
      console.log(`Record ${airtableRecordId} locked successfully.`);
    }
  } catch (error) {
    console.error(`Error locking record ${airtableRecordId}:`, error);
  }
}

async function unlockAirtableRecord(airtableRecordId) {
  console.log(`Unlocking Airtable record ${airtableRecordId}`);

  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ/${airtableRecordId}`;
  
  // Add a delay to ensure Airtable has time to sync before unlocking
  await sleep(6000); // 3 seconds delay before unlocking

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields: {} }), // Empty body when unlocking
    });

    const data = await response.json();
    if (!response.ok) {
      console.error(`Error unlocking record ${airtableRecordId}:`, data.error || data);
    } else {
      console.log(`Record ${airtableRecordId} unlocked successfully.`);
    }
  } catch (error) {
    console.error(`Failed to unlock record ${airtableRecordId}:`, error);
  }
}

async function fetchUnprocessedEventsFromAirtable() {
  console.log('Fetching unprocessed events from Airtable...');
  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ?filterByFormula=NOT({Processed})&pageSize=100`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    const records = data.records.map((record) => ({
      id: record.id,
      title: record.fields['Calendar Event Name'] || 'Untitled Event',
      start: new Date(record.fields['StartDate']),
      end: new Date(record.fields['EndDate']),
      description: record.fields['description'] || '',
      processed: record.fields['Processed'] || false,
      streetAddress: record.fields['Street Address'] || '', 
      city: record.fields['City'] || '', 
      state: record.fields['State'] || '', 
      zipCode: record.fields['Zip Code'] || '', 
      homeownerName: record.fields['Homeowner Name'] || '',  
      billable: record.fields['Billable/Non Billable'] === 'Billable',  
      repairChargeAmount: record.fields['Repair Charge Amount'] || '',  
      billableReason: record.fields['Billable Reason'] || '',  
    }));

    console.log('Airtable events to process:', records.length);

    if (records.length === 0) {
      console.log('No more events to process. Terminating script.');
      isTerminated = true; 
      return [];
    }

    return records;

  } catch (error) {
    console.error('Error fetching Airtable events:', error);
    return [];
  }
}

function clearAllTimers() {
  const highestTimeoutId = setTimeout(() => {}, 0);
  for (let i = 0; i < highestTimeoutId; i++) {
    clearTimeout(i);
  }
  // Also clear intervals
  const highestIntervalId = setInterval(() => {}, 0);
  for (let i = 0; i < highestIntervalId; i++) {
    clearInterval(i);
  }
}


async function checkForDuplicateEvent(event, calendarId, session, offsetMinutes = 5) {
  console.log('Checking for duplicate event...');

  // Create an offset window for checking duplicates (e.g., ±5 minutes)
  const offsetMillis = offsetMinutes * 60 * 1000;
  const timeMin = new Date(event.start.getTime() - offsetMillis).toISOString();
  const timeMax = new Date(event.end.getTime() + offsetMillis).toISOString();

  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?timeMin=${timeMin}&timeMax=${timeMax}`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${session.provider_token}`,
      },
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Error fetching Google Calendar events:', data);
      return null;
    }

    const duplicateEvent = data.items.find(existingEvent => {
      const normalizedSummary = (existingEvent.summary || '').trim().toLowerCase();
      const normalizedTitle = (event.title || '').trim().toLowerCase();
      const existingLocation = (existingEvent.location || '').trim().toLowerCase();
      const eventLocation = `${event.streetAddress}, ${event.city}, ${event.state}, ${event.zipCode}`.trim().toLowerCase();

      const startMatch = new Date(existingEvent.start.dateTime).getTime() === event.start.getTime();
      const endMatch = new Date(existingEvent.end.dateTime).getTime() === event.end.getTime();

      return normalizedSummary === normalizedTitle && existingLocation === eventLocation && startMatch && endMatch;
    });

    if (duplicateEvent) {
      console.log('Duplicate event found:', duplicateEvent.id);
      return duplicateEvent.id;  // Return the ID if a duplicate is found
    } else {
      console.log('No duplicate event found.');
      return null;
    }
  } catch (error) {
    console.error('Error checking for duplicates:', error);
    return null;
  }
}


function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function populateGoogleCalendarWithAirtableRecords(
  calendarId,
  calendarName,
  session,
  setAddedRecords,
  setFailedRecords,
  setNoChangeRecords,
  setAllRecordsProcessed
) {
  console.log(`Starting to populate Google Calendar "${calendarName}" with Airtable records...`);

  // Step 1: Remove duplicates from Google Calendar and mark them as unprocessed in Airtable
  await removeDuplicateEvents(); // Remove duplicates and mark them as unprocessed in Airtable

  // Step 2: Fetch unprocessed events from Airtable
  const airtableEvents = await fetchUnprocessedEventsFromAirtable();
  const totalFetchedRecords = airtableEvents.length;

  if (totalFetchedRecords === 0) {
    console.log(`No unprocessed events to sync for calendar "${calendarName}".`);
    setAllRecordsProcessed(true); // Set as processed if no unprocessed records found
    return;
  }

  // Initialize counters and lists to track event processing outcomes
  let createdEventsCount = 0;
  const added = [];
  const failed = [];
  const noChange = [];
  const processedRecordIds = new Set();

  // Step 3: Process each unprocessed event
  for (const event of airtableEvents) {
    if (event.googleEventId || event.processed) {
      console.log(`Skipping event "${event.title}" - GoogleEventId or Processed status already set.`);
      noChange.push(event.title);
      processedRecordIds.add(event.id);
      continue;
    }

    try {
      await lockAirtableRecord(event.id);

      // Check for duplicate in Google Calendar
      let googleEventId = await checkForDuplicateEvent(event, calendarId, session);

      if (googleEventId) {
        const googleEvent = await getGoogleCalendarEvent(googleEventId, calendarId, session);

        if (isEventDifferent(event, googleEvent)) {
          console.log(`Updating event "${event.title}" as it has changed.`);
          await deleteGoogleCalendarEvent(googleEventId, calendarId, session); // Delete old event
          googleEventId = await createGoogleCalendarEvent(event, calendarId, session); // Create updated event
          await updateAirtableWithGoogleEventIdAndProcessed(event.id, googleEventId, true);
        } else {
          console.log(`No changes detected for event "${event.title}". Skipping.`);
        }
        noChange.push(event.title);
        processedRecordIds.add(event.id);
      } else {
        // If no existing or duplicate event, create a new Google event
        googleEventId = await createGoogleCalendarEvent(event, calendarId, session);
        if (googleEventId) {
          await updateAirtableWithGoogleEventIdAndProcessed(event.id, googleEventId, true);
          added.push(event.title);
          createdEventsCount++;
        } else {
          failed.push(event.title);
        }
      }
    } catch (error) {
      console.error(`Error processing event "${event.title}":`, error);
      failed.push(event.title);
    } finally {
      await unlockAirtableRecord(event.id); // Ensure unlocking of records
    }

    // Delay to avoid rate limits
    await sleep(12000); 
  }

  // Update state with results
  setAddedRecords((prev) => [...prev, ...added]);
  setFailedRecords((prev) => [...prev, ...failed]);
  setNoChangeRecords(noChange);

  console.log(`Total number of events created: ${createdEventsCount}`);
  console.log(`Total number of records processed for calendar "${calendarName}": ${processedRecordIds.size}`);
}


function isEventDifferent(airtableEvent, googleEvent) {
  // Log the events being compared for debugging
  console.log('Comparing Airtable Event:', airtableEvent);
  console.log('Comparing Google Event:', googleEvent);

  // Ensure that fields are not undefined by providing default empty strings
  const airtableTitle = (airtableEvent.title || '').trim().toLowerCase();
  const googleTitle = (googleEvent.summary || '').trim().toLowerCase();
  console.log(`Airtable Title: "${airtableTitle}", Google Title: "${googleTitle}"`);
  const isTitleDifferent = airtableTitle !== googleTitle;

  // Check for start time difference
  const airtableStart = new Date(airtableEvent.start).getTime();
  const googleStart = new Date(googleEvent.start?.dateTime || googleEvent.start?.date).getTime();
  console.log(`Airtable Start Time: ${airtableStart}, Google Start Time: ${googleStart}`);
  const isStartDifferent = airtableStart !== googleStart;

  // Check for end time difference
  const airtableEnd = new Date(airtableEvent.end).getTime();
  const googleEnd = new Date(googleEvent.end?.dateTime || googleEvent.end?.date).getTime();
  console.log(`Airtable End Time: ${airtableEnd}, Google End Time: ${googleEnd}`);
  const isEndDifferent = airtableEnd !== googleEnd;

  

  // Ensure location is not undefined before comparison
  const airtableLocation = `${airtableEvent.streetAddress || ''}, ${airtableEvent.city || ''}, ${airtableEvent.state || ''}, ${airtableEvent.zipCode || ''}`.trim().toLowerCase();
  const googleLocation = (googleEvent.location || '').trim().toLowerCase();
  console.log(`Airtable Location: "${airtableLocation}", Google Location: "${googleLocation}"`);
  const isLocationDifferent = airtableLocation !== googleLocation;

  // Log the results of each comparison
  console.log('Is Title Different?', isTitleDifferent);
  console.log('Is Start Time Different?', isStartDifferent);
  console.log('Is End Time Different?', isEndDifferent);
  console.log('Is Location Different?', isLocationDifferent);

  // Return true if any of the key fields are different
  return isTitleDifferent || isStartDifferent || isEndDifferent || isLocationDifferent;
}




async function getGoogleCalendarEvent(eventId, calendarId, session) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${session.provider_token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const data = await response.json();
      console.error('Failed to fetch Google Calendar event:', data);
      return null;
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching Google Calendar event:', error);
    return null;
  }
}

async function compareAndSyncEvents(airtableEvents, googleEvents, session, calendarId, calendarName) {
  for (const airtableEvent of airtableEvents) {
    const googleEvent = googleEvents.find((event) => event.id === airtableEvent.googleEventId);

    if (googleEvent) {
      // Compare the events' details
      if (isEventDifferent(airtableEvent, googleEvent)) {
        console.log(`Event "${airtableEvent.title}" has changed. Updating Google Calendar "${calendarName}"...`);


        } else {
          console.error(`Failed to update event "${airtableEvent.title}" in Google Calendar "${calendarName}".`);
        }
      }
    }
  }

async function fetchCurrentAndFutureGoogleCalendarEvents(calendarId, session) {
  let allEvents = [];
  let nextPageToken = null;
  
  const now = new Date().toISOString(); // Get the current date and time

  do {
    const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?timeMin=${now}&maxResults=2500${nextPageToken ? `&pageToken=${nextPageToken}` : ''}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${session.provider_token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const data = await response.json();
      console.error('Error fetching Google Calendar events:', data);
      return [];
    }

    const data = await response.json();
    allEvents = allEvents.concat(data.items);
    nextPageToken = data.nextPageToken;

  } while (nextPageToken);

  return allEvents;
}

async function deleteGoogleCalendarEvent(eventId, calendarId, session) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`;

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${session.provider_token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const data = await response.json();
      console.error('Failed to delete Google Calendar event:', data);
      return false;
    }
    console.log('Google Calendar event deleted successfully:', eventId);
    return true;
  } catch (error) {
    console.error('Error deleting Google Calendar event:', error);
    return false;
  }
}

function CalendarSection({
  calendarId,
  calendarName,
  session,
  signOut,
  setAddedRecords,
  setFailedRecords,
  setRateLimitInfo,
  setRateLimitHit,
  setNoChangeRecords,
  setChangedRecords,
  triggerSync,
  setTriggerSync,
  handleSyncNow,  // Add the handleSyncNow prop here
  allRecordsProcessed,  // Destructure this prop
  setAllRecordsProcessed  // Destructure this prop
}) {
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [progress, setProgress] = useState(0);
  const [manualSyncComplete, setManualSyncComplete] = useState(false); // Track manual sync completion

  

  useEffect(() => {
    const syncEvents = async () => {
      // Exit if all records are processed
      if (allRecordsProcessed) {
        console.log('All records have been processed. Skipping further sync attempts.');
        terminateScript(); // Terminate the script before returning
        return;  // Exit the function after terminating
      }
  
      // Exit if outside sync time range
      if (!isWithinTimeRange()) {
        console.log("Syncing is allowed only between 6:45 AM and 10:00 PM. Current time is outside this range.");
        return;
      }
  
      console.log('Attempting to sync events...');
  
      if (session && triggerSync) {
        setProgress(0);
  
        if (!session.provider_token) {
          console.error('No valid session token found. Logging out.');
          signOut();
          return;
        }
  
        try {
          // Sync the events with Google Calendar
          await populateGoogleCalendarWithAirtableRecords(
            calendarId,
            calendarName,
            session,
            setAddedRecords,
            setFailedRecords,
            setNoChangeRecords,
            setAllRecordsProcessed
          );
  
          console.log(`Finished syncing events to Google Calendar "${calendarName}"`);
  
          // After syncing, check for duplicates
          await removeDuplicateEvents();
  
          // Set the last sync time and other status updates
          setLastSyncTime(new Date());
          setTriggerSync(false);
          setManualSyncComplete(true);  // Mark manual sync as complete
  
        } catch (error) {
          console.error(`Error syncing Airtable to Google Calendar "${calendarName}":`, error);
        }
      }
    };
  
    // Only proceed if manual sync is triggered
    if (triggerSync) {
      console.log(`Manual sync triggered for calendar: ${calendarName}`);
      syncEvents(); // Call the async syncEvents function
    }
  
  }, [
    session, // React hook dependencies
    signOut,
    calendarId,
    calendarName,
    setAddedRecords,
    setFailedRecords,
    setNoChangeRecords,
    setAllRecordsProcessed,
    triggerSync, // Trigger sync when this changes
    setTriggerSync,
    allRecordsProcessed, // Terminate if all records are processed
  ]);

  // After syncing Google Calendar
  useEffect(() => {
    if (manualSyncComplete) {
      console.log("Manual sync complete. Stopping further checks.");
      return; // Terminate further event checks after sync
    }

    // Continue with other operations if needed
  }, [manualSyncComplete]); // Dependency on manual sync completion

  return (
    <div className="calendar-item">
      <h2>{calendarName}</h2>

      {lastSyncTime && <p>Last sync: {lastSyncTime.toLocaleString()}</p>}
      {progress > 0 && <p>Sync progress: {progress.toFixed(0)}%</p>}
  
      {!isWithinTimeRange() && (
        <p style={{ color: 'red' }}>Syncing is allowed only between 6:45 AM and 10:00 PM. Please try again later.</p>
      )}
  
  {isWithinTimeRange() && !allRecordsProcessed && (
  <button onClick={handleSyncNow}>Sync Now</button>
)}

{allRecordsProcessed && (
  <p>All records have been processed. No further syncs are required.</p>
)}

    </div>
  );
}

async function removeDuplicateEvents(calendarId, session) {
  // Check for a valid session and provider token
  if (!session || !session.provider_token) {
    console.error('Session or provider token is not available.');
    return;
  }

  console.log("Checking for duplicate events in Airtable and Google Calendar...");

  // Fetch unprocessed events from Airtable
  const airtableEvents = await fetchUnprocessedEventsFromAirtable();
  const seenEvents = new Map();
  const duplicates = [];

  // Identify duplicates based on unique key composed of title, homeownerName, and start date
  for (const event of airtableEvents) {
    const uniqueKey = `${event.title}|${event.homeownerName}|${event.start.toISOString()}`;
    if (seenEvents.has(uniqueKey)) {
      duplicates.push(event.id);
    } else {
      seenEvents.set(uniqueKey, event.id);
    }
  }

  if (duplicates.length > 0) {
    console.log(`Found ${duplicates.length} duplicates in Airtable. Processing deletions...`);

    for (const duplicateId of duplicates) {
      // Find the duplicate event in Airtable and delete it from Google Calendar
      const duplicateEvent = airtableEvents.find(event => event.id === duplicateId);
      if (duplicateEvent && duplicateEvent.googleEventId) {
        const success = await deleteGoogleCalendarEvent(duplicateEvent.googleEventId, calendarId, session);
        
        if (success) {
          // Mark as unprocessed in Airtable to allow recreation
          await markAirtableRecordAsUnprocessed(duplicateId);
          console.log(`Duplicate event ${duplicateEvent.googleEventId} deleted from Google Calendar and marked unprocessed in Airtable.`);
        }
      }
    }
  } else {
    console.log('No duplicates found in Airtable.');
  }
}

const App = () => {
  const session = useSession();
  const supabase = useSupabaseClient();
  const { isLoading } = useSessionContext();

  // State variables
  const [nextSyncTime, setNextSyncTime] = useState(null);
  const [addedRecords, setAddedRecords] = useState([]);
  const [failedRecords, setFailedRecords] = useState([]);
  const [noChangeRecords, setNoChangeRecords] = useState([]);
  const [changedRecords, setChangedRecords] = useState([]);
  const [triggerSync, setTriggerSync] = useState(false);
  const [allRecordsProcessed, setAllRecordsProcessed] = useState(false);
  const [timeUntilExpiration, setTimeUntilExpiration] = useState(null);
  const [retryCount, setRetryCount] = useState(0);

  const calendarInfo = [
    { id: 'c_ebe1fcbce1be361c641591a6c389d4311df7a97961af0020c889686ae059d20a@group.calendar.google.com', name: 'Savannah' }
  ].sort((a, b) => a.name.localeCompare(b.name));

  const handleLogin = async () => {
    try {
      console.log('Logging in user...');
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          scopes: 'https://www.googleapis.com/auth/calendar',
          redirectTo: window.location.origin,
        },
      });
    } catch (loginError) {
      console.error('Error during login:', loginError);
    }
  };

  const handleLogout = async () => {
    console.log('Logging out user...');
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Error during logout:', error.message);
    } else {
      console.log('User logged out successfully.');
    }
  };

  // Refreshed session
  const refreshSession = async () => {
    try {
      const { error } = await supabase.auth.refreshSession();
      if (error) {
        console.error('Error refreshing session:', error.message);
        if (retryCount < 2) {
          setRetryCount((prevRetryCount) => prevRetryCount + 1);
        } else {
          console.warn('Session still invalid after retries. Logging out user.');
          handleLogout();
        }
      } else {
        console.log('Session refreshed');
        setRetryCount(0);
      }
    } catch (e) {
      console.error("An error occurred while refreshing session:", e);
      handleLogout();
    }
  };

  // Refresh token 5 minutes before expiry
  useEffect(() => {
    if (session) {
      const refreshTokenBeforeExpiration = async () => {
        const expiresAt = session.expires_at;
        const currentTime = Math.floor(Date.now() / 1000);
        const timeUntilExpiry = expiresAt - currentTime;

        if (timeUntilExpiry <= 300) {
          await refreshSession();
        }

        const daysUntilExpiration = Math.floor(timeUntilExpiry / (3600 * 24));
        const hoursUntilExpiration = Math.floor((timeUntilExpiry % (3600 * 24)) / 3600);
        const minutesUntilExpiration = Math.floor((timeUntilExpiry % 3600) / 60);
        const secondsUntilExpiration = timeUntilExpiry % 60;

        setTimeUntilExpiration(`${daysUntilExpiration}d ${hoursUntilExpiration}h ${minutesUntilExpiration}m ${secondsUntilExpiration}s`);
      };

      const interval = setInterval(refreshTokenBeforeExpiration, 1000);
      return () => clearInterval(interval);
    }
  }, [session]);

  const handleSyncNow = async () => {
    console.log('Manual sync button clicked.');

    if (!session || !session.access_token) {
      console.log("Access token missing, refreshing session...");
      await refreshSession();
    }

    if (!session || !session.access_token) {
      console.error("Session or access token is still missing after refresh. Cannot proceed with syncing.");
      handleLogout();
      return;
    }

    setTriggerSync(true);
  };

  const getMillisecondsUntilNextQuarterHour = () => {
    const now = new Date();
    const minutes = now.getMinutes();
    const nextQuarterMinutes = Math.ceil(minutes / 15) * 15; // Calculate the next quarter hour
    const nextSyncTime = new Date(now);
    nextSyncTime.setMinutes(nextQuarterMinutes, 0, 0); // Set to next quarter hour
    if (nextQuarterMinutes === 60) {
      nextSyncTime.setHours(now.getHours() + 1, 0, 0, 0); // Handle the case for 00:00
    }
    return nextSyncTime.getTime() - now.getTime(); // Return milliseconds until the next quarter-hour
  };

  const scheduleNextSync = () => {
    const delay = getMillisecondsUntilNextQuarterHour();
    const nextSyncTimeValue = new Date(Date.now() + delay);
    setNextSyncTime(nextSyncTimeValue);

    console.log(`Next sync scheduled for ${nextSyncTimeValue.toLocaleTimeString()}`);
    setTimeout(() => {
      handleSyncNow();
      setInterval(handleSyncNow, 15 * 60 * 1000);
    }, delay);
  };

  useEffect(() => {
    scheduleNextSync();
  }, []);

  const initializePage = async () => {
    console.log('Initializing page...');

    if (!session || !session.provider_token) {
      console.error('Session or provider token is missing. Cannot initialize page.');
      handleLogout();
      return;
    }

    try {
      await syncGoogleCalendarWithAirtable('c_ebe1fcbce1be361c641591a6c389d4311df7a97961af0020c889686ae059d20a@group.calendar.google.com', session);
      const airtableEvents = await fetchUnprocessedEventsFromAirtable();

      if (airtableEvents.length === 0) {
        console.log('No more events to process. All records are synced.');
        setAllRecordsProcessed(true);
        return;
      }

      const googleEvents = await fetchCurrentAndFutureGoogleCalendarEvents(
        'c_ebe1fcbce1be361c641591a6c389d4311df7a97961af0020c889686ae059d20a@group.calendar.google.com',
        session
      );

      await compareAndSyncEvents(airtableEvents, googleEvents, session);
      await deleteDuplicateGoogleCalendarEvents('c_ebe1fcbce1be361c641591a6c389d4311df7a97961af0020c889686ae059d20a@group.calendar.google.com', session);

    } catch (error) {
      console.error("Error during initialization:", error);
    }
  };

  useEffect(() => {
    if (session) {
      initializePage();
    }
  }, [session]);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="App">
      <div className="container">
        <h3>Automatic Sync at Each Quarter Hour</h3>
        {nextSyncTime && <p>Next sync scheduled for {nextSyncTime.toLocaleTimeString()}</p>}
        {timeUntilExpiration && <p>Token will expire in: {timeUntilExpiration}</p>}

        <button onClick={refreshSession}>Refresh Session</button>

        {!session ? (
          <button onClick={handleLogin}>Sign In with Google</button>
        ) : (
          <button onClick={handleLogout}>Logout</button>
        )}

        {session && (
          <div style={{ width: '100%', margin: '0 auto' }}>
            <>
              <hr />
              <button onClick={handleSyncNow}>Sync Now</button>
              <div className="calendar-grid">
                {calendarInfo.map((calendar) => (
                  <CalendarSection
                    key={calendar.id}
                    calendarId={calendar.id}
                    calendarName={calendar.name}
                    session={session}
                    signOut={handleLogout}
                    setAddedRecords={setAddedRecords}
                    setFailedRecords={setFailedRecords}
                    setNoChangeRecords={setNoChangeRecords}
                    setChangedRecords={setChangedRecords}
                    triggerSync={triggerSync}
                    setTriggerSync={setTriggerSync}
                    allRecordsProcessed={allRecordsProcessed}
                    setAllRecordsProcessed={setAllRecordsProcessed}
                  />
                ))}
              </div>
            </>
          </div>
        )}
      </div>
    </div>
  );
};

// Helper function to check time range
const isWithinTimeRange = () => {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinutes = now.getMinutes();

  const isAfterStart = currentHour > 6 || (currentHour === 6 && currentMinutes >= 45); // After 6:45 AM
  const isBeforeEnd = currentHour < 22; // Before 10:00 PM

  return isAfterStart && isBeforeEnd;
};

export default App;
