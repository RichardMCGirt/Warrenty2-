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

  // Set the minimum time to the current date and time in ISO format
  const timeMin = new Date().toISOString();

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

      // Generate a link to the Google Calendar event using the event ID and start date
      const eventLink = `https://calendar.google.com/calendar/embed?src=${calendarId}&ctz=America%2FToronto&dates=${formatGoogleCalendarDate(event.start)}/${formatGoogleCalendarDate(event.end)}`;
      
      // Update Airtable with the new Google Event ID, processed status, and Calendar Link
      await updateAirtableWithGoogleEventIdAndProcessed(event.id, data.id, true, eventLink);

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

// Helper function to format dates for Google Calendar links
function formatGoogleCalendarDate(date) {
  const eventDate = new Date(date);
  return eventDate.toISOString().replace(/-|:|\.\d+/g, '');
}

async function updateAirtableWithGoogleEventIdAndProcessed(airtableRecordId, googleEventId, hasChanges, calendarLink) {
  if (!hasChanges) {
    console.log(`No changes found for record ${airtableRecordId}. Skipping update.`);
    return; // Exit the function if no changes are found
  }

  console.log(`Updating Airtable record ${airtableRecordId} with Google Event ID: ${googleEventId}, marking as processed, and adding Calendar Link`);

  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ/${airtableRecordId}`;
  const updateData = {
    fields: {
      GoogleEventId: googleEventId,
      Processed: true, // Mark the record as processed to avoid duplicate syncs
      CalendarLink: calendarLink, // Add the generated Calendar Link here
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

  const airtableEvents = await fetchUnprocessedEventsFromAirtable(); // Line 591
  const totalFetchedRecords = airtableEvents.length;

  if (totalFetchedRecords === 0) {
    console.log(`No unprocessed events to sync for calendar "${calendarName}".`);
    return;
  }

  let createdEventsCount = 0;
  const added = [];
  const failed = [];
  const noChange = [];
  const processedRecordIds = new Set();

  for (const event of airtableEvents) {
    if (event.googleEventId || event.processed) {
      console.log(`Skipping event "${event.title}" - GoogleEventId or Processed status already set.`);
      noChange.push(event.title);
      processedRecordIds.add(event.id);
      continue;
    }

    try {
      await lockAirtableRecord(event.id);

      // Check if there's a duplicate or an existing event in Google Calendar
      let googleEventId = await checkForDuplicateEvent(event, calendarId, session);

      if (googleEventId) {
        const googleEvent = await getGoogleCalendarEvent(googleEventId, calendarId, session);

        // Compare the event in Airtable and Google Calendar
        if (isEventDifferent(event, googleEvent)) {
          console.log(`Updating event "${event.title}" as it has changed.`);
          await deleteGoogleCalendarEvent(googleEventId, calendarId, session);  // Delete the old event
          googleEventId = await createGoogleCalendarEvent(event, calendarId, session);  // Create a new one with updated details
          await updateAirtableWithGoogleEventIdAndProcessed(event.id, googleEventId, true);
        } else {
          console.log(`No changes detected for event "${event.title}". Skipping.`);
        }
        noChange.push(event.title);
        processedRecordIds.add(event.id);
        await unlockAirtableRecord(event.id);
        continue;
      }

      // If no existing event or duplicate is found, create a new Google event
      googleEventId = await createGoogleCalendarEvent(event, calendarId, session);
      if (googleEventId) {
        await updateAirtableWithGoogleEventIdAndProcessed(event.id, googleEventId, true);
        added.push(event.title);
        createdEventsCount++;
      } else {
        failed.push(event.title);
      }

      processedRecordIds.add(event.id);
    } catch (error) {
      console.error(`Error processing event "${event.title}":`, error);
      failed.push(event.title);
    }

    await unlockAirtableRecord(event.id);
    await sleep(12000);  // Delay to avoid hitting rate limits
  }

  setAddedRecords((prev) => [...prev, ...added]);
  setFailedRecords((prev) => [...prev, ...failed]);
  setNoChangeRecords(noChange);

  console.log(`Total number of events created: ${createdEventsCount}`);
  console.log(`Total number of records processed for calendar "${calendarName}": ${processedRecordIds.size}`);
}

function isEventDifferent(airtableEvent, googleEvent) {
  // Compare key fields: title, start, end, description, location
  const isStartDifferent = new Date(airtableEvent.start).getTime() !== new Date(googleEvent.start.dateTime).getTime();
  const isEndDifferent = new Date(airtableEvent.end).getTime() !== new Date(googleEvent.end.dateTime).getTime();

  return  isStartDifferent || isEndDifferent ;
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

async function checkIfAllRecordsProcessed() {
  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ?filterByFormula=NOT({Processed})&pageSize=100`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    if (data.records.length === 0) {
      console.log('All records have been processed.');
      return true; // All records are processed
    } else {
      console.log(`${data.records.length} records are still unprocessed.`);
      return false;  // There are still unprocessed records
    }
  } catch (error) {
    console.error('Error checking unprocessed records:', error);
    return false;  // In case of an error, assume not all records are processed
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

async function removeDuplicateEvents() {
  console.log('Checking for duplicate events in Airtable...');
  const airtableEvents = await fetchUnprocessedEventsFromAirtable(); // Line 591
  const seenEvents = new Map();
  const duplicates = [];

  for (const event of airtableEvents) {
    const uniqueKey = `${event.title}|${event.homeownerName}|${event.start.toISOString()}`;
    if (seenEvents.has(uniqueKey)) {
      duplicates.push(event.id);
    } else {
      seenEvents.set(uniqueKey, event.id);
    }
  }

  if (duplicates.length > 0) {
    console.log(`Deleting ${duplicates.length} duplicates.`);
  } else {
    console.log('No duplicates found.');
  }
}

function App() {
  const session = useSession();  // Access the session from Supabase hook
  const supabase = useSupabaseClient();
  const { isLoading } = useSessionContext();

  const [addedRecords, setAddedRecords] = useState([]);
  const [failedRecords, setFailedRecords] = useState([]);
  const [noChangeRecords, setNoChangeRecords] = useState([]); 
  const [changedRecords, setChangedRecords] = useState([]); 
  const [triggerSync, setTriggerSync] = useState(false);
  const [allRecordsProcessed, setAllRecordsProcessed] = useState(false); 

  const calendarInfo = [
    { id: 'c_ebe1fcbce1be361c641591a6c389d4311df7a97961af0020c889686ae059d20a@group.calendar.google.com', name: 'Savannah' }
  ].sort((a, b) => a.name.localeCompare(b.name));

  const handleSyncNow = async () => {
    console.log('Manual sync button clicked.');
    
    // Get unprocessed events from Airtable
    const events = await fetchUnprocessedEventsFromAirtable();
    
    // Call processEvents and pass session as a parameter
    await processEvents(events, 'c_ebe1fcbce1be361c641591a6c389d4311df7a97961af0020c889686ae059d20a@group.calendar.google.com', session);  // Replace 'your_calendar_id' with your actual Google Calendar ID
    
    setTriggerSync(true);
  };
  

  // Login handler
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

  // Logout handler
  const handleLogout = async () => {
    if (!session) {
      console.error('No active session found. The user may already be logged out.');
      return;
    }

    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('Logout failed:', error.message);
      } else {
        console.log('User logged out successfully.');
      }
    } catch (err) {
      console.error('Unexpected error during logout:', err);
    }
  };

  useEffect(() => {
    const initializePage = async () => {
        console.log('Initializing page...');

        if (!session || !session.provider_token) {
            console.error('Session or provider token is not available. User may not be logged in.');
            return;
        }

        const airtableEvents = await fetchUnprocessedEventsFromAirtable(); 

        if (airtableEvents.length === 0) {
            console.log('No more events to process. Terminating script.');
            return;
        }

        const googleEvents = await fetchCurrentAndFutureGoogleCalendarEvents(
            'c_ebe1fcbce1be361c641591a6c389d4311df7a97961af0020c889686ae059d20a@group.calendar.google.com',
            session
        );

        await compareAndSyncEvents(airtableEvents, googleEvents, session);


        await deleteDuplicateGoogleCalendarEvents(
            'c_ebe1fcbce1be361c641591a6c389d4311df7a97961af0020c889686ae059d20a@group.calendar.google.com',
            session
        );
    };

    if (session) {
        initializePage();
    }
  }, [session]);

  let isSyncing = false;

  async function manualSync() {
    if (isSyncing || allRecordsProcessed) {
      console.log('Sync already in progress or all records processed, skipping...');
      return;
    }

    isSyncing = true; 
    console.log('Manual sync triggered...');

    await fetchAndProcessEvents();

    isSyncing = false; 
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  let syncInProgress = false;

  async function fetchAndProcessEvents() {
    if (syncInProgress) {
        console.log("Sync is already in progress, skipping new request.");
        return;
    }

    syncInProgress = true;

    try {
        let events = await fetchUnprocessedEventsFromAirtable();

        while (events.length > 0) {
            console.log(`Processing ${events.length} events...`);
            await processEvents(events);

            events = await fetchUnprocessedEventsFromAirtable();
            await sleep(5000);
        }

        console.log("No more events to process. Terminating sync.");

        if (events.length === 0) {
          console.log("All events processed, updating UI...");
          setAllRecordsProcessed(true);
      }

    } catch (error) {
        console.error("Error while processing events:", error);
        syncInProgress = false; 
    }
  }

  useEffect(() => {
    console.log('Session details at API call:', session);
    if (!session || !session.provider_token) {
      console.error('Session or provider token is missing. Cannot fetch Google Calendar event.');
    } else {
      console.log('Proceeding with API request...');
    }
  }, [session]);

   

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="App">
      <div className="container">
      
        <h3 style={{ fontSize: '16px', textAlign: 'center' }}>Manual Sync Only</h3>

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

              <div className="records-summary">
                <h3>Records Summary</h3>
                <div className="summary-container">
                  <div className="added-records">
                    <h4>Successfully Added Records:</h4>
                    {addedRecords.length > 0 ? (
                      <ul>
                        {addedRecords.map((record, index) => (
                          <li key={index}>{record}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>No records added.</p>
                    )}
                  </div>

                  <div className="failed-records">
                    <h4>Failed to Add Records:</h4>
                    {failedRecords.length > 0 ? (
                      <ul>
                        {failedRecords.map((record, index) => (
                          <li key={index}>{record}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>No records failed.</p>
                    )}
                  </div>

                  <div className="change-records">
                    <h4>Records with no Changes:</h4>
                    {changedRecords.length > 0 ? (
                      <ul>
                        {changedRecords.map((record, index) => (
                          <li key={index}>{record}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>No records without changes.</p>
                    )}
                  </div>

                  <div className="no-change-records">
                    <h4>Records with Changes:</h4>
                    {noChangeRecords.length > 0 ? (
                      <ul>
                        {noChangeRecords.map((record, index) => (
                          <li key={index}>{record}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>No records with changes.</p>
                    )}
                  </div>
                </div>
              </div>

              <button id="manualSyncButton" onClick={manualSync}>Sync Now</button>

              <button onClick={handleSyncNow} disabled={triggerSync}>Sync Now</button>
            </>
          </div>
        )}
      </div>
    </div>
  );
}

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
