import React, { useState, useEffect } from 'react';
import './App.css';
import { useSession, useSupabaseClient, useSessionContext } from '@supabase/auth-helpers-react';
import { CircularProgressbar } from 'react-circular-progressbar'; // Make sure this package is installed

async function removeStaleGoogleEventIds(calendarId, session) {
  console.log('Checking for stale GoogleEventIds in Airtable...');

  // Step 1: Fetch all Google events
  const googleEvents = await fetchAllGoogleCalendarEvents(calendarId, session);
  const googleEventIds = new Set(googleEvents.map(event => event.id)); // Store Google event IDs in a Set for quick lookup

  // Step 2: Fetch all Airtable records that have a GoogleEventId
  const airtableUrl = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ?filterByFormula=NOT({GoogleEventId} = '')&pageSize=100`;
  try {
    const response = await fetch(airtableUrl, {
      headers: {
        Authorization: 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    const recordsToUpdate = [];

    // Step 3: Check if each GoogleEventId in Airtable exists in Google Calendar
    for (const record of data.records) {
      const airtableGoogleEventId = record.fields.GoogleEventId;

      if (!googleEventIds.has(airtableGoogleEventId)) {
        console.log(`Google Event ${airtableGoogleEventId} not found in Google Calendar. Removing from Airtable record: ${record.id}`);
        recordsToUpdate.push({
          id: record.id,
          fields: { GoogleEventId: null }, // Clear the GoogleEventId in Airtable
        });
      }
    }

    // Step 4: Batch update Airtable to remove stale GoogleEventIds
    if (recordsToUpdate.length > 0) {
      console.log(`Removing GoogleEventId from ${recordsToUpdate.length} Airtable records...`);

      const batchUrl = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ`;
      const batchSize = 10; // Airtable recommends a batch size of 10

      for (let i = 0; i < recordsToUpdate.length; i += batchSize) {
        const batch = recordsToUpdate.slice(i, i + batchSize);
        try {
          const batchResponse = await fetch(batchUrl, {
            method: 'PATCH',
            headers: {
              Authorization: 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ records: batch }),
          });

          const result = await batchResponse.json();
          if (!batchResponse.ok) {
            console.error('Error removing stale GoogleEventId:', result.error);
          } else {
            console.log('Successfully removed stale GoogleEventId for batch:', result);
          }
        } catch (error) {
          console.error('Error during batch update to remove stale GoogleEventIds:', error);
        }
      }
    } else {
      console.log('No stale GoogleEventIds found.');
    }
  } catch (error) {
    console.error('Error fetching Airtable records:', error);
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
      // Check if the event is linked to a GoogleEventId in Airtable
      if (!airtableGoogleEventIds.has(event.id)) {
        // If not in Airtable, mark as a duplicate
        duplicates.push(event.id); // Add duplicate event ID to the list
      } else {
        console.log(`Skipping deletion for event linked to GoogleCalendarId: ${event.id}`);
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




async function uncheckProcessedForMissingGoogleEventId() {
  console.log("Checking for records missing GoogleEventId but marked as processed...");

  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ?filterByFormula=AND({Processed}, NOT({GoogleEventId}))&pageSize=100`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    const recordsToUpdate = data.records.map((record) => ({
      id: record.id,
      fields: { Processed: false }, // Uncheck Processed
    }));

    if (recordsToUpdate.length === 0) {
      console.log('No records found where Processed is checked but GoogleEventId is missing.');
      return;
    }

    console.log(`Found ${recordsToUpdate.length} records to uncheck Processed.`);

    // Batch update to uncheck Processed for those records
    const batchUrl = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ`;
    const batchSize = 10; // Airtable recommends batch size of 10

    for (let i = 0; i < recordsToUpdate.length; i += batchSize) {
      const batch = recordsToUpdate.slice(i, i + batchSize);

      try {
        const response = await fetch(batchUrl, {
          method: 'PATCH',
          headers: {
            Authorization: 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ records: batch }),
        });

        const result = await response.json();
        if (!response.ok) {
          console.error('Error unchecking Processed:', result.error);
        } else {
          console.log('Successfully unchecked Processed for batch:', result);
        }
      } catch (error) {
        console.error('Error during batch update to uncheck Processed:', error);
      }
    }

  } catch (error) {
    console.error('Error fetching records for unchecking Processed:', error);
  }
}


async function createGoogleCalendarEvent(event, calendarId, session) {
  // First, check for duplicates
  const existingGoogleEventId = await checkForDuplicateEvent(event, calendarId, session);
  
  if (existingGoogleEventId) {
    console.log('Duplicate event found in Google Calendar, skipping creation:', existingGoogleEventId);
    return existingGoogleEventId;
  }

  // Create a descriptive string for the event
  const description = `
    ${event.description ? `Description: ${event.description}\n` : ''}
    Homeowner Name: ${event.homeownerName}
    Lot Number: ${event.lotNumber}
    Community/Neighborhood: ${event.community}
    Last Updated: ${event.lastUpdated}
  `;

  // If no duplicate found, create a new Google Calendar event
  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;
  const updatedEvent = {
    summary: event.title,
    description: description.trim(),  // This will now include the additional fields in the description
    start: { dateTime: event.start.toISOString() },
    end: { dateTime: event.end.toISOString() },
    location: `${event.streetAddress}, ${event.city}, ${event.state}, ${event.zipCode}`,
  };

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
      await updateAirtableWithGoogleEventIdAndProcessed(event.id, data.id, true);
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

      // Add delay to ensure the record is updated properly before unlocking
      await sleep(5000);  // Wait 5 seconds to ensure Airtable registers the update
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

// Function to format the LastUpdated field
function formatLastUpdated(lastUpdated) {
  if (!lastUpdated || lastUpdated === 'Not Updated') {
    return 'Not Updated';
  }

  // Create a Date object from the LastUpdated value
  const date = new Date(lastUpdated);

  // Use toLocaleDateString to format the date
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long', // You can also use 'short' or 'numeric' for different styles
    day: 'numeric'
  });
}


async function fetchAirtableEvents() {
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
      googleEventId: record.fields['GoogleEventId'] || null,
      homeownerName: record.fields['Homeowner Name'] || 'Unknown',  // New field
      lastUpdated: formatLastUpdated(record.fields['LastUpdated']),  // Format the date
      lotNumber: record.fields['Lot Number'] || 'Unknown',  // New field
      community: record.fields['Community/Neighborhood'] || 'Unknown',  // New field
      processed: record.fields['Processed'] || false,
    }));

    console.log('Airtable events to process:', records.length);
    return records;

  } catch (error) {
    console.error('Error fetching Airtable events:', error);
    return [];
  }
}


async function checkForDuplicateEvent(event, calendarId, session, offsetMinutes = 5) {
  console.log('checkForDuplicateEvent called with:');
  console.log('Event:', event);
  console.log('Calendar ID:', calendarId);
  console.log('Session:', session);
  
  // Create an offset window for checking duplicates (e.g., ±5 minutes)
  const offsetMillis = offsetMinutes * 60 * 1000;
  const timeMin = new Date(event.start.getTime() - offsetMillis).toISOString();
  const timeMax = new Date(event.end.getTime() + offsetMillis).toISOString();
  
  console.log('Offset timeMin:', timeMin);
  console.log('Offset timeMax:', timeMax);

  console.log('Access Token:', session.provider_token);
console.log('Token Expires At:', session.expires_at);
console.log('Current Time:', Math.floor(Date.now() / 1000));

if (Math.floor(Date.now() / 1000) >= session.expires_at) {
  console.log('Token has expired. Please refresh the token.');
}

  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?timeMin=${timeMin}&timeMax=${timeMax}`;
  console.log('Request URL:', url);

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: 'Bearer ' + session.provider_token,
      },
    });

    console.log('Response status:', response.status);

    if (response.status === 401) {
      console.error('Unauthorized: Check your access token and session.');
    }

    const data = await response.json();
    console.log('Response data:', data);

    if (data.items && data.items.length > 0) {
      console.log('Number of events found:', data.items.length);

      const existingEvent = data.items.find((existingEvent) => {
        // Normalize values by trimming whitespace and lowercasing
        const normalizedSummary = (existingEvent.summary || '').trim().toLowerCase();
        const normalizedTitle = (event.title || '').trim().toLowerCase();
        const normalizedLocation = (existingEvent.location || '').trim();
        const eventLocation = `${event.streetAddress}, ${event.city}, ${event.state}, ${event.zipCode}`.trim();

        console.log('Checking event:', {
          existingSummary: normalizedSummary,
          eventTitle: normalizedTitle,
          existingLocation: normalizedLocation,
          eventLocation: eventLocation,
          startTimeMatch: new Date(existingEvent.start.dateTime).getTime() === event.start.getTime(),
          endTimeMatch: new Date(existingEvent.end.dateTime).getTime() === event.end.getTime()
        });

        return (
          normalizedSummary === normalizedTitle &&
          normalizedLocation === eventLocation &&
          new Date(existingEvent.start.dateTime).getTime() === event.start.getTime() &&
          new Date(existingEvent.end.dateTime).getTime() === event.end.getTime()
        );
      });

      if (existingEvent) {
        console.log('Duplicate event found in Google Calendar:', existingEvent.id);
        return existingEvent.id;  // Return the ID if a duplicate is found
      }
    } else {
      console.log('No matching events found in the time range.');
    }
  } catch (error) {
    console.error('Error checking for duplicate events in Google Calendar:', error);
    return null;
  }

  return null;
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
  console.log(`Starting to populate Google Calendar "${calendarName}" (ID: ${calendarId}) with Airtable records...`);

  const airtableEvents = await fetchAirtableEvents();
  const totalFetchedRecords = airtableEvents.length;

  if (totalFetchedRecords === 0) {
    console.log(`No unprocessed events to sync for calendar "${calendarName}".`);
    setAllRecordsProcessed(true);
    await checkAndSyncDifferences(calendarId, calendarName, session, airtableEvents);
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

      let googleEventId = await checkForDuplicateEvent(event, calendarId, session);

      if (googleEventId) {
        await updateAirtableWithGoogleEventIdAndProcessed(event.id, googleEventId, false);
        noChange.push(event.title);
        processedRecordIds.add(event.id);
        await unlockAirtableRecord(event.id);
        continue;
      }

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
      console.error(`Error processing event "${event.title}" for calendar "${calendarName}":`, error);
      failed.push(event.title);
    }

    await unlockAirtableRecord(event.id);
    await sleep(12000); // 12-second delay

    const remainingUnprocessedRecords = await checkIfAllRecordsProcessed();
    if (remainingUnprocessedRecords === 0) {
      setAllRecordsProcessed(true);
      console.log(`All records have been processed for calendar "${calendarName}".`);
      break;
    }
  }

  setAddedRecords((prev) => [...prev, ...added]);
  setFailedRecords((prev) => [...prev, ...failed]);
  setNoChangeRecords(noChange);

  console.log(`Total number of events created: ${createdEventsCount}`);
  console.log(`Total number of records processed for calendar "${calendarName}": ${processedRecordIds.size}`);

  await checkAndSyncDifferences(calendarId, calendarName, session, airtableEvents);
  await removeGoogleEventIdForUnprocessedRecords();
  await checkAndSyncDifferences(calendarId, calendarName, session, airtableEvents);

}



async function checkAndSyncDifferences(calendarId, calendarName, session, airtableEvents) {
  console.log(`Checking for differences between Airtable and Google Calendar "${calendarName}"...`);
  
  for (const event of airtableEvents) {
    if (event.googleEventId) {
      const googleEvent = await getGoogleCalendarEvent(event.googleEventId, calendarId, session);

      if (googleEvent && isEventDifferent(event, googleEvent)) {
        console.log(`Event "${event.title}" has changed in calendar "${calendarName}". Updating...`);
        const isDeleted = await deleteGoogleCalendarEvent(event.googleEventId, calendarId, session);
        if (isDeleted) {
          const newGoogleEventId = await createGoogleCalendarEvent(event, calendarId, session);
          if (newGoogleEventId) {
            await updateAirtableWithGoogleEventIdAndProcessed(event.id, newGoogleEventId, true);
          }
        }
      }
    }
  }
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

async function updateGoogleCalendarEvent(eventId, airtableEvent, session, calendarId, calendarName) {
  console.log(`Updating event in calendar "${calendarName}" (ID: ${calendarId})`);

  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`;

  const updatedEvent = {
    summary: airtableEvent.title,
    description: airtableEvent.description,
    start: { dateTime: airtableEvent.start.toISOString() },
    end: { dateTime: airtableEvent.end.toISOString() },
    location: airtableEvent.location,
  };

  try {
    const response = await fetch(url, {
      method: 'PUT', // Use PUT to update an event
      headers: {
        Authorization: `Bearer ${session.provider_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatedEvent),
    });

    const data = await response.json();
    if (response.ok) {
      console.log(`Event "${airtableEvent.title}" updated successfully in calendar "${calendarName}"`);
    } else {
      console.error(`Failed to update event "${airtableEvent.title}" in calendar "${calendarName}":`, data);
    }

    return response.ok;
  } catch (error) {
    console.error(`Error updating event "${airtableEvent.title}" in calendar "${calendarName}":`, error);
    return false;
  }
}




async function compareAndSyncEvents(airtableEvents, googleEvents, session, calendarId, calendarName) {
  for (const airtableEvent of airtableEvents) {
    const googleEvent = googleEvents.find((event) => event.id === airtableEvent.googleEventId);

    if (googleEvent) {
      // Compare the events' details
      if (isEventDifferent(airtableEvent, googleEvent)) {
        console.log(`Event "${airtableEvent.title}" has changed. Updating Google Calendar "${calendarName}"...`);

        // Update the Google Calendar event with the Airtable details
        const isUpdated = await updateGoogleCalendarEvent(googleEvent.id, airtableEvent, session, calendarId, calendarName);

        if (isUpdated) {
          console.log(`Successfully updated event "${airtableEvent.title}" in Google Calendar "${calendarName}".`);
        } else {
          console.error(`Failed to update event "${airtableEvent.title}" in Google Calendar "${calendarName}".`);
        }
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


async function removeGoogleEventIdForUnprocessedRecords() {
  console.log("Checking for unprocessed records with a GoogleEventId...");

  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ?filterByFormula=NOT({Processed})&pageSize=100`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    const recordsToUpdate = data.records
      .filter((record) => record.fields['GoogleEventId']) // Check if GoogleEventId exists
      .map((record) => ({
        id: record.id,
        fields: { GoogleEventId: null } // Set GoogleEventId to null
      }));

    if (recordsToUpdate.length === 0) {
      console.log('No unprocessed records with GoogleEventId found.');
      return;
    }

    console.log(`Found ${recordsToUpdate.length} unprocessed records with GoogleEventId. Removing GoogleEventId...`);

    // Batch update to remove GoogleEventId for unprocessed records
    const batchUrl = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ`;
    const batchSize = 10; // Airtable recommends batch size of 10

    for (let i = 0; i < recordsToUpdate.length; i += batchSize) {
      const batch = recordsToUpdate.slice(i, i + batchSize);

      try {
        const response = await fetch(batchUrl, {
          method: 'PATCH',
          headers: {
            Authorization: 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ records: batch }),
        });

        const result = await response.json();
        if (!response.ok) {
          console.error('Error removing GoogleEventId:', result.error);
        } else {
          console.log('Successfully removed GoogleEventId for batch:', result);
        }
      } catch (error) {
        console.error('Error during batch update to remove GoogleEventId:', error);
      }
    }

  } catch (error) {
    console.error('Error fetching unprocessed records:', error);
  }
}






function isEventDifferent(airtableEvent, googleEvent) {
  // Compare key fields: title, start, end, description, location
  const isTitleDifferent = (airtableEvent.title || '').trim() !== (googleEvent.summary || '').trim();
  const isStartDifferent = new Date(airtableEvent.start).getTime() !== new Date(googleEvent.start.dateTime).getTime();
  const isEndDifferent = new Date(airtableEvent.end).getTime() !== new Date(googleEvent.end.dateTime).getTime();
  const isDescriptionDifferent = (airtableEvent.description || '').trim() !== (googleEvent.description || '').trim();
  const isLocationDifferent = (airtableEvent.location || '').trim() !== (googleEvent.location || '').trim();

  return isTitleDifferent || isStartDifferent || isEndDifferent || isDescriptionDifferent || isLocationDifferent;
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
      return 0;
    } else {
      console.log(`${data.records.length} records are still unprocessed.`);
      return data.records.length;
    }
  } catch (error) {
    console.error('Error checking unprocessed records:', error);
    return -1;  // Return -1 in case of an error
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

  useEffect(() => {
    const syncEvents = async () => {
      if (allRecordsProcessed) {
        console.log('All records have been processed. Skipping further sync attempts.');
        return; // Exit the sync process if all records are processed
      }

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

        await populateGoogleCalendarWithAirtableRecords(
          calendarId,
          calendarName,
          session,
          setAddedRecords,
          setFailedRecords,
          setNoChangeRecords,
          setAllRecordsProcessed // Make sure this is passed here as well
        )
        .then(async () => {
          console.log(`Finished syncing events to Google Calendar "${calendarName}"`);
          await removeDuplicateEvents(); // Check for duplicates after syncing
          setLastSyncTime(new Date());
          setTriggerSync(false);
        })
        .catch((error) => {
          console.error(`Error syncing Airtable to Google Calendar "${calendarName}":`, error);
        });
      }
    };

    if (triggerSync) {
      console.log(`Manual sync triggered for calendar: ${calendarName}`);
      syncEvents();
    }
  }, [
    session,
    signOut,
    calendarId,
    calendarName,
    setAddedRecords,
    setFailedRecords,
    setRateLimitInfo,
    triggerSync,
    setTriggerSync,
    setRateLimitHit,
    setNoChangeRecords,
    setChangedRecords,
    allRecordsProcessed, // Add the processed state dependency
  ]);

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
  const events = await fetchAirtableEvents();
  const seenEvents = new Map();
  const duplicates = [];

  for (const event of events) {
    const uniqueKey = `${event.title}|${event.homeownerName}|${event.start.toISOString()}`;
    if (seenEvents.has(uniqueKey)) {
      duplicates.push(event.id);
    } else {
      seenEvents.set(uniqueKey, event.id);
    }
  }

  if (duplicates.length > 0) {
    console.log(`Deleting ${duplicates.length} duplicates.`);
    await batchDeleteAirtableRecords(duplicates);
  } else {
    console.log('No duplicates found.');
  }
}


async function batchDeleteAirtableRecords(recordIds, batchSize = 10) {
  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ`;

  for (let i = 0; i < recordIds.length; i += batchSize) {
    const batch = recordIds.slice(i, i + batchSize).map(id => ({ id }));

    try {
      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'Authorization': 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ records: batch }),
      });

      const data = await response.json();
      if (!response.ok) {
        console.error('Error deleting Airtable records:', data.error);
      } else {
        console.log('Batch of records deleted successfully:', data);
      }
    } catch (error) {
      console.error('Error during batch delete request:', error);
    }
  }
}


const FIFTEEN_MINUTES = 15 * 60 * 1000;  // 15 minutes in milliseconds
function App() {
  const session = useSession();  // Access the session from Supabase hook
  const supabase = useSupabaseClient();
  const { isLoading } = useSessionContext();

  const [addedRecords, setAddedRecords] = useState([]);
  const [failedRecords, setFailedRecords] = useState([]);
  const [noChangeRecords, setNoChangeRecords] = useState([]); // State for records with no changes
  const [changedRecords, setChangedRecords] = useState([]); // State for records with changes
  const [triggerSync, setTriggerSync] = useState(false);
  const [rateLimitHit, setRateLimitHit] = useState(false); 
  const [timeLeft, setTimeLeft] = useState(FIFTEEN_MINUTES); // Initialize timeLeft state
  const [percentage, setPercentage] = useState(0); // Initialize percentage state
  const [allRecordsProcessed, setAllRecordsProcessed] = useState(false); // Define this state to track processed records

  const calendarInfo = [
    { id: 'c_ebe1fcbce1be361c641591a6c389d4311df7a97961af0020c889686ae059d20a@group.calendar.google.com', name: 'Savannah' }
  ].sort((a, b) => a.name.localeCompare(b.name));

  // Login handler
  const handleLogin = async () => {
    try {
      console.log('Logging in user...');
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          scopes: 'https://www.googleapis.com/auth/calendar',
          redirectTo: window.location.origin, // Redirect back to your app after login
        },
      });
    } catch (loginError) {
      console.error('Error during login:', loginError);
    }
  };

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
      
      // Ensure the session is available
      if (!session || !session.provider_token) {
        console.error('Session or provider token is not available. User may not be logged in.');
        return;
      }
      
      // Fetch all events from Google Calendar and Airtable
      const airtableEvents = await fetchAirtableEvents();
      const googleEvents = await fetchCurrentAndFutureGoogleCalendarEvents(
        'c_ebe1fcbce1be361c641591a6c389d4311df7a97961af0020c889686ae059d20a@group.calendar.google.com', 
        session
      );
      
      // Compare events and update Google Calendar if needed
      await compareAndSyncEvents(airtableEvents, googleEvents, session);
      
      // Uncheck "Processed" for records missing GoogleEventId
      await uncheckProcessedForMissingGoogleEventId();

      await removeStaleGoogleEventIds('c_ebe1fcbce1be361c641591a6c389d4311df7a97961af0020c889686ae059d20a@group.calendar.google.com', session);

      
      // Delete duplicate Google Calendar events
      await deleteDuplicateGoogleCalendarEvents(
        'c_ebe1fcbce1be361c641591a6c389d4311df7a97961af0020c889686ae059d20a@group.calendar.google.com', 
        session
      );
    };
    
    // Call initializePage only when the session is available
    if (session) {
      initializePage();
    }
  }, [session]);
  
  


  useEffect(() => {
    const checkSession = async () => {
      if (!session) {
        console.log('No valid session found on startup. User needs to log in.');
      } else {
        console.log('Session is valid on startup:', session);
      }
    };

    checkSession();
  }, [session]);

  const formatTime = (time) => {
    const minutes = Math.floor(time / 60000);
    const seconds = Math.floor((time % 60000) / 1000);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  useEffect(() => {
    if (timeLeft > 0) {
      const countdownInterval = setInterval(() => {
        setTimeLeft((prevTime) => prevTime - 1000);  // Decrease countdown by 1 second
        const progress = (FIFTEEN_MINUTES - timeLeft) / FIFTEEN_MINUTES * 100;
        setPercentage(progress);
      }, 1000);

      return () => clearInterval(countdownInterval);  // Clear interval on unmount
    } else {
      setTriggerSync(true); // Trigger sync when countdown reaches 0
      setTimeLeft(FIFTEEN_MINUTES); // Reset countdown after sync
    }
  }, [timeLeft]);

  const handleSyncNow = () => {
    console.log('Manual sync button clicked.');
    setTriggerSync(true); 
  };

  // Greeting function with formatted name
  const getGreeting = () => {
    if (!session || !session.user) {
      return 'Hello, Guest';
    }

    const currentHour = new Date().getHours();
    let name = session.user.email.split('@')[0];
    name = name.replace(/\./g, ' ').split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

    if (currentHour < 12) {
      return `Good morning, ${name}`;
    } else if (currentHour < 18) {
      return `Good afternoon, ${name}`;
    } else {
      return `Good evening, ${name}`;
    }
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="App">
      <div className="container">
        <h2>{getGreeting()}</h2> 
        <h3 style={{ fontSize: '16px', textAlign: 'center' }}>Time Until Next Sync</h3>
        <button onClick={handleLogout}>Logout</button>

        {session && (
          <div className="progress-section" style={{ textAlign: 'center' }}>
            <div style={{ width: '80px', height: '80px', margin: '0 auto' }}>
              <CircularProgressbar
                value={percentage}
                text={formatTime(timeLeft)}
                styles={{
                  path: { stroke: '#4caf50' },
                  trail: { stroke: '#d6d6d6' },
                  text: {
                    fontSize: '25px',
                    fill: '#000',
                    dominantBaseline: 'middle',
                    textAnchor: 'middle',
                  },
                }}
              />
            </div>
          </div>
        )}

        <div style={{ width: '100%', margin: '0 auto' }}>
          {session ? (
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

              <button onClick={handleSyncNow} disabled={triggerSync}>Sync Now</button>
            </>
          ) : (
            <>
              <button onClick={handleLogin}>Sign In With Google</button>
            </>
          )}
        </div>
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
