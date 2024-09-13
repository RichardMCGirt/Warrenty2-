import React, { useState, useEffect } from 'react';
import './App.css';
import { useSession, useSupabaseClient, useSessionContext } from '@supabase/auth-helpers-react';




async function createGoogleCalendarEvent(event, calendarId, session, signOut, setRateLimitInfo, setRateLimitHit) {
  console.log(`Attempting to create a new Google Calendar event for calendar: ${calendarId}`, event);

  // Final duplicate check before creating
  const existingGoogleEventId = await checkForDuplicateEvent(event, calendarId, session);
  if (existingGoogleEventId) {
    console.log('Duplicate event detected in final check, skipping creation:', existingGoogleEventId);
    return existingGoogleEventId;
  }

  // Proceed with event creation
  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;

  const updatedEvent = {
    summary: event.title,
    description: `
      ${event.description}
      \nlocation: ${event.location}
      \nHomeowner Name: ${event.homeownerName}
      \nMaterials Needed: ${event.materialsNeeded || 'Not specified'}
    `,
    start: { dateTime: event.start.toISOString() },
    end: { dateTime: event.end.toISOString() },
    location: `${event.streetAddress}, ${event.city}, ${event.state}, ${event.zipCode}`,
  };
  

  console.log('Event data being sent to Google Calendar API:', updatedEvent);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + session.provider_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatedEvent),
    });

    if (response.status === 429) {
      console.error('Rate limit reached. Stopping further requests.');
      setRateLimitHit(true);
      return null;
    }

    const data = await response.json();
    if (response.ok) {
      console.log('Event successfully created in Google Calendar with ID:', data.id);
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


async function updateGoogleCalendarEvent(
  event,
  calendarId,
  eventId,
  session,
  signOut,
  setRateLimitInfo = () => {}, // Default empty function
  setRateLimitHit = () => {} // Default empty function
) {  console.log(`Updating Google Calendar event for ID: ${eventId}`);

  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`;

  const updatedEvent = {
    summary: event.title,
    description: `
      ${event.description}
      \nlocation: ${event.location}
      \nHomeowner Name: ${event.homeownerName}
      \nMaterials Needed: ${event.materialsNeeded || 'Not specified'}
    `,
    start: { dateTime: event.start.toISOString() },
    end: { dateTime: event.end.toISOString() },
    location: `${event.streetAddress}, ${event.city}, ${event.state}, ${event.zipCode}`,
  };

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer ' + session.provider_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatedEvent),
    });

    // Check for rate limit and handle it
    if (response.status === 429) {
      console.error('Rate limit reached. Stopping further requests.');
      setRateLimitHit(true); // Stop further requests
      return null;
    }

    const data = await response.json();
    const remaining = response.headers.get('X-RateLimit-Remaining');
    const limit = response.headers.get('X-RateLimit-Limit');
    const reset = response.headers.get('X-RateLimit-Reset');
    setRateLimitInfo({ remaining, limit, reset });

    if (response.ok) {
      console.log('Event successfully updated in Google Calendar with ID:', data.id);
      return data.id;
    } else {
      console.error('Failed to update event:', data);
      if (data.error && data.error.code === 401) {
        signOut(); // Handle invalid token by signing out
      }
      return null;
    }
  } catch (error) {
    console.error('Error during Google Calendar API request in updateGoogleCalendarEvent:', error);
    return null;
  }
}


async function updateAirtableWithGoogleEventIdAndProcessed(airtableRecordId, googleEventId) {
  console.log(`Updating Airtable record ${airtableRecordId} with Google Event ID: ${googleEventId} and marking as processed`);
  
  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ?filterByFormula=NOT({GoogleEventId} = BLANK())`;
  const updateData = {
    fields: {
      Processed: true,  // Mark as processed
      LastUpdated: new Date().toISOString() // Optional field to track last update
    },
  };

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updateData),
    });

    const data = await response.json();
    console.log('Airtable update response:', data);

    if (!response.ok) {
      throw new Error(data.error);
    }

    console.log('Airtable record successfully updated with Google Event ID and marked as processed:', data);
  } catch (error) {
    console.error('Error during Airtable API request:', error);
  }
}

async function lockAirtableRecord(airtableRecordId) {
  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ/${airtableRecordId}`;
  const updateData = {
    fields: {
      Processing: true, // Mark record as being processed
    },
  };

  try {
    await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updateData),
    });
    console.log(`Locked record ${airtableRecordId} for processing`);
  } catch (error) {
    console.error(`Failed to lock record ${airtableRecordId}`, error);
  }
}

async function unlockAirtableRecord(airtableRecordId) {
  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ/${airtableRecordId}`;

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields: {} }), // Empty body if you are no longer updating any fields
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Error unlocking Airtable record:', data.error || data);
      throw new Error(data.error || 'Unknown error');
    }

    console.log(`Unlocked record ${airtableRecordId} after processing`);
  } catch (error) {
    console.error(`Failed to unlock record ${airtableRecordId}`, error);
  }
}

async function updateAirtableWithProcessed(airtableRecordId) {
  console.log(`Marking Airtable record ${airtableRecordId} as processed`);

  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ/${airtableRecordId}`;
  const updateData = {
    fields: {
      Processed: true,  // Mark as processed
    },
  };

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updateData),
    });

    const data = await response.json();
    console.log('Airtable update response:', data);

    if (data.error) {
      console.error('Error updating Airtable with processed status:', data.error);
    } else {
      console.log('Airtable record successfully marked as processed:', data);
    }
  } catch (error) {
    console.error('Error during Airtable API request:', error);
  }
}

async function fetchAirtableEvents(retryCount = 0) {
  console.log('Fetching unprocessed events from Airtable...');

  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ?filterByFormula=OR(NOT({Processed}), {GoogleEventId} != BLANK())`;

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`Error fetching events from Airtable: HTTP ${response.status}`);
      return [];
    }

    const data = await response.json();
    console.log('Raw Airtable data fetched:', data);

    const filteredRecords = data.records
      .filter((record) => {
        // Ensure event has a name, start and end dates
        return record.fields['Calendar Event Name'] && record.fields['StartDate'] && record.fields['EndDate'];
      })
      .map((record) => ({
        id: record.id,
        title: record.fields['Calendar Event Name'] || 'Untitled Event',
        start: new Date(record.fields['StartDate']),
        end: new Date(record.fields['EndDate']),
        description: record.fields['Billable Reason (If Billable)'] || '',
        branch: record.fields['b'] || 'Unknown',
        homeownerName: record.fields['Homeowner Name'] || 'Unknown',
        materialsNeeded: record.fields['Materials Needed'] || 'Not specified',
        streetAddress: record.fields['Street Address'] || 'Unknown',
        city: record.fields['City'] || 'Unknown',
        state: record.fields['State'] || 'Unknown',
        zipCode: record.fields['Zip Code'] || 'Unknown',
        googleEventId: record.fields['GoogleEventId'] || null,
        processed: record.fields['Processed'] || false,  // Track the Processed field
      }));

    console.log(`Airtable events to process: ${filteredRecords.length}`, filteredRecords);
    return filteredRecords;

  } catch (error) {
    console.error('Error fetching events from Airtable:', error);
    return [];
  }
}

// Utility function to format date and time in 'M/D/YYYY h:mm AM/PM' format
function formatDateTime(date) {
  return new Date(date).toLocaleString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: true,
  });
}

// Function to ensure time for events from Google Calendar
function ensureTime(event) {
  if (!event.start.dateTime) {
    return {
      start: new Date(`${event.start.date}T00:00:00`),
      end: new Date(`${event.start.date}T12:00:00`),
    };
  }
  return {
    start: new Date(event.start.dateTime),
    end: new Date(event.end.dateTime),
  };
}

async function fetchGoogleCalendarEvents(calendarId, session) {
  const now = new Date().toISOString();
  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?timeMin=${now}&singleEvents=true&orderBy=startTime`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: 'Bearer ' + session.provider_token,
      },
    });

    const data = await response.json();

    if (response.ok) {
      return data.items || [];
    } else {
      // Log the entire error details for more insights
      console.error('Failed to fetch Google Calendar events. Error Details:', data);

      if (data.error) {
        console.error('Error Code:', data.error.code);
        console.error('Error Message:', data.error.message);
        console.error('Error Details:', data.error.errors);
      }

      // Handle specific error codes such as unauthorized (401)
      if (data.error && data.error.code === 401) {
        console.log('Token expired or unauthorized. Attempting to refresh token...');
        // Handle token refresh
        const refreshedToken = await refreshAccessToken(session.refresh_token);
        if (refreshedToken) {
          session.provider_token = refreshedToken; // Update session with new token
          return fetchGoogleCalendarEvents(calendarId, session); // Retry fetching events with new token
        } else {
          throw new Error('Failed to refresh token');
        }
      }
      return [];
    }
  } catch (error) {
    console.error('Error fetching Google Calendar events:', error.message);
    return [];
  }
}



async function syncGoogleCalendarToAirtable(calendarId, session, signOut, setAddedRecords, setFailedRecords) {
  console.log(`Syncing Google Calendar "${calendarId}" to Airtable...`);

  // Fetch Google Calendar events
  const googleEvents = await fetchGoogleCalendarEvents(calendarId, session);
  console.log(`Fetched ${googleEvents.length} Google Calendar events.`);

  const added = [];
  const failed = [];

  // First, sync Google Calendar events to Airtable
  for (const googleEvent of googleEvents) {
    const { start, end } = ensureTime(googleEvent);
    const formattedStartDate = formatDateTime(start);
    const formattedEndDate = formatDateTime(end);

    // Check if the event already exists in Airtable by GoogleEventId
    const duplicateRecord = await checkForDuplicateEventInAirtable(googleEvent.id);

    if (duplicateRecord) {
      console.log(`Event "${googleEvent.summary}" already exists in Airtable with GoogleEventId: ${googleEvent.id}. Skipping.`);
      continue;
    }

    const airtableRecord = {
      fields: {
        StartDate: formattedStartDate,      // Store Start Date
        EndDate: formattedEndDate,          // Store End Date
        'Event Title': googleEvent.summary || 'Untitled Event',  // Store Event Title
        GoogleEventId: googleEvent.id,      // Store Google Calendar Event ID
        LastUpdated: new Date().toISOString(), // Store the last update time
        Processed: true,                    // Mark as processed
      },
    };

    try {
      // Add the Google Calendar event into Airtable
      const response = await fetch(`https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(airtableRecord),
      });

      const data = await response.json();

      if (response.ok) {
        console.log(`Successfully added Google event to Airtable: ${googleEvent.summary}`);
        added.push(googleEvent.summary);
      } else {
        console.error(`Failed to add Google event to Airtable. Status: ${response.status}`);
        failed.push(googleEvent.summary);
      }
    } catch (error) {
      console.error(`Error adding Google event to Airtable: ${error.message}`);
      failed.push(googleEvent.summary);
    }
  }

  setAddedRecords((prev) => [...prev, ...added]);
  setFailedRecords((prev) => [...prev, ...failed]);

  console.log(`Finished syncing Google Calendar "${calendarId}" to Airtable.`);
}

// Check for duplicate event in Airtable based on GoogleEventId
async function checkForDuplicateEventInAirtable(googleEventId) {
  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ?filterByFormula=GoogleEventId='${googleEventId}'`;

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (response.ok && data.records.length > 0) {
      return data.records[0]; // Return the first matching record
    }
    return null; // No duplicate found
  } catch (error) {
    console.error('Error checking for duplicate in Airtable:', error);
    return null;
  }
}

async function checkForDuplicateEvent(event, calendarId, session) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?timeMin=${event.start.toISOString()}&timeMax=${event.end.toISOString()}`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: 'Bearer ' + session.provider_token,
      },
    });

    const data = await response.json();
    
    if (data.items && data.items.length > 0) {
      const existingEvent = data.items.find(
        (existingEvent) =>
          existingEvent.summary === event.title && // Match title
          existingEvent.location === `${event.streetAddress}, ${event.city}, ${event.state}, ${event.zipCode}` // Match location
      );

      return existingEvent ? existingEvent.id : null; // Return the Google Event ID if a match is found
    }
  } catch (error) {
    console.error('Error checking for duplicate events in Google Calendar:', error);
    return null;
  }

  return null;
}

async function checkForDuplicateLocation(location) {
  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ?filterByFormula=AND({Location}='${location}', {GoogleEventId} != BLANK())`;

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (response.ok && data.records.length > 0) {
      console.log('Duplicate location found:', data.records[0]);
      return data.records[0]; // Return the first duplicate found
    } else {
      console.log('No duplicate location found.');
      return null; // No duplicate found
    }
  } catch (error) {
    console.error('Error fetching duplicate location from Airtable:', error);
    return null;
  }
}


async function handleEventCreationOrUpdate(event, calendarId, session, signOut, setRateLimitInfo, setRateLimitHit) {
  // Step 1: Check for duplicate by location
  const location = `${event.streetAddress}, ${event.city}, ${event.state}, ${event.zipCode}`;
  const duplicateRecord = await checkForDuplicateLocation(location);

  if (duplicateRecord) {
    console.log(`Duplicate location found for event "${event.title}". Checking for updates...`);
    
    // Step 2: Compare the start and end times to determine if an update is needed
    if (new Date(duplicateRecord.fields.StartDate).getTime() !== event.start.getTime() ||
        new Date(duplicateRecord.fields.EndDate).getTime() !== event.end.getTime()) {
      console.log('Event times have changed. Updating Google Calendar and Airtable...');
      // Update the Google Calendar event and Airtable record
      const updatedGoogleEventId = await updateGoogleCalendarEvent(event, calendarId, duplicateRecord.fields.GoogleEventId, session, signOut, setRateLimitInfo, setRateLimitHit);
      await updateAirtableWithProcessed(duplicateRecord.id); // Mark the record as processed after update
    } else {
      console.log('No changes detected. Skipping update.');
    }

  } else {
    console.log('No duplicate found. Creating new event and record...');
    // Step 3: Create new event and record
    const newGoogleEventId = await createGoogleCalendarEvent(event, calendarId, session, signOut, setRateLimitInfo, setRateLimitHit);
    if (newGoogleEventId) {
      // Create a new record in Airtable
      await updateAirtableWithGoogleEventIdAndProcessed(null, newGoogleEventId);
    }
  }
}



function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function populateGoogleCalendarWithAirtableRecords(
  calendarId,
  calendarName,
  session,
  signOut,
  setAddedRecords,
  setFailedRecords,
  setRateLimitInfo,
  rateLimitHit,
  setRateLimitHit
) {
  console.log(`Starting to populate Google Calendar "${calendarName}" with Airtable records...`);

  const airtableEvents = await fetchAirtableEvents();
  console.log(`Processing ${airtableEvents.length} Airtable events for Google Calendar sync...`);

  const added = [];
  const failed = [];

  for (const event of airtableEvents) {
    if (rateLimitHit) {
      console.log(`Rate limit hit. Stopping further processing.`);
      break;
    }

    console.log(`Processing event "${event.title}"...`);

    if (event.branch.toLowerCase() === 'unknown' || event.branch.toLowerCase() !== calendarName.toLowerCase()) {
      console.log(`Skipping event "${event.title}" due to branch mismatch.`);
      continue;
    }

    // Lock the record to prevent it from being processed by another process
    await lockAirtableRecord(event.id);

    try {
      if (event.googleEventId) {
        console.log(`Event "${event.title}" already has a GoogleEventId: ${event.googleEventId}. Verifying in Google Calendar...`);

        const existingGoogleEventId = await checkForDuplicateEvent(event, calendarId, session);

        // Only proceed if existingGoogleEventId is not null
        if (existingGoogleEventId) {
          const updatedGoogleEventId = await updateGoogleCalendarEvent(
            event,
            calendarId,
            existingGoogleEventId,
            session,
            signOut,
            setRateLimitInfo,
            setRateLimitHit
          );

          if (updatedGoogleEventId) {
            added.push(event.title);
            await updateAirtableWithProcessed(event.id); // Mark as processed
          } else {
            failed.push(event.title);
          }
        } else {
          console.log(`No duplicate found for event "${event.title}". Skipping update.`);
        }
      } else {
        // Check Google Calendar for an existing event to avoid duplicates
        const googleEventId = await createGoogleCalendarEvent(
          event,
          calendarId,
          session,
          signOut,
          setRateLimitInfo,
          setRateLimitHit
        );

        if (googleEventId) {
          await updateAirtableWithGoogleEventIdAndProcessed(event.id, googleEventId);
          added.push(event.title);
        } else {
          failed.push(event.title);
        }
      }
    } catch (error) {
      console.error(`Error processing event "${event.title}":`, error);
      failed.push(event.title);
    }

    await unlockAirtableRecord(event.id); // Unlock the record after processing
    await sleep(1000); // Adding delay between requests
  }

  setAddedRecords((prev) => [...prev, ...added]);
  setFailedRecords((prev) => [...prev, ...failed]);

  console.log(`Finished populating Google Calendar "${calendarName}" with Airtable records.`);
}



function CalendarSection({
  calendarId,
  calendarName,
  session,
  signOut,
  setAddedRecords,
  setFailedRecords,
  setRateLimitInfo,
  triggerSync,
  setTriggerSync
}) {
  const [lastSyncTime, setLastSyncTime] = useState(null);

  useEffect(() => {
    const syncEvents = () => {
      const now = new Date();
      console.log('Attempting to sync events...');
  
      if (session && triggerSync) {
        if (!session.provider_token) {
          console.error('No valid session token found. Logging out.');
          signOut();
          return;
        }
  
        console.log('Session valid. Initiating sync...');
        populateGoogleCalendarWithAirtableRecords(
          calendarId,
          calendarName,
          session,
          signOut,
          setAddedRecords,
          setFailedRecords,
          setRateLimitInfo
        )
          .then(() => {
            console.log(`Finished syncing events to Google Calendar "${calendarName}"`);
            setLastSyncTime(new Date()); // Update last sync time
            setTriggerSync(false); // Reset the triggerSync after sync
          })
          .catch((error) =>
            console.error(`Error syncing Airtable to Google Calendar "${calendarName}":`, error)
          );
      }
    };
  
    if (triggerSync) {
      console.log(`Manual sync triggered for calendar: ${calendarName}`);
      syncEvents(); // Call syncEvents once here, no recursion
    }
  }, [session, signOut, calendarId, calendarName, setAddedRecords, setFailedRecords, setRateLimitInfo, lastSyncTime, triggerSync, setTriggerSync]);
  

  return (
    <div className="calendar-item">
      <h2>{calendarName}</h2>
    </div>
  );
}

// Function to refresh the access token
async function refreshAccessToken(refresh_token) {
  const tokenURL = 'https://oauth2.googleapis.com/token';
  const params = new URLSearchParams();

  params.append('client_id', process.env.REACT_APP_GOOGLE_CLIENT_ID);
  params.append('client_secret', process.env.REACT_APP_GOOGLE_CLIENT_SECRET);
  params.append('refresh_token', refresh_token);
  params.append('grant_type', 'refresh_token');

  console.log('client_id:', process.env.REACT_APP_GOOGLE_CLIENT_ID);
  console.log('client_secret:', process.env.REACT_APP_GOOGLE_CLIENT_SECRET);
  console.log('refresh_token:', refresh_token);

  try {
    const response = await fetch(tokenURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const data = await response.json();

    if (response.ok) {
      console.log('Access token refreshed:', data.access_token);
      return data.access_token;
    } else {
      // Log detailed error information
      console.error('Failed to refresh access token:');
      console.error('Error Code:', data.error);  // The specific error code, e.g., 'invalid_grant'
      console.error('Error Description:', data.error_description);  // Detailed description of the error
      console.error('Full Error Response:', data);  // Log the full response object for any additional info
      return null;
    }
  } catch (error) {
    console.error('Error refreshing access token:', error);
    return null;
  }
}

function App() {
  const session = useSession();
  const supabase = useSupabaseClient();
  const { isLoading } = useSessionContext();

  const [addedRecords, setAddedRecords] = useState([]);
  const [failedRecords, setFailedRecords] = useState([]);
  const [triggerSync, setTriggerSync] = useState(false);
  const [rateLimitHit, setRateLimitHit] = useState(false);

  const calendarInfo = [
    { id: 'c_ebe1fcbce1be361c641591a6c389d4311df7a97961af0020c889686ae059d20a@group.calendar.google.com', name: 'Charleston Warranty Calendar' }

  ];

  const handleSyncNow = async () => {
    console.log('Manual sync button clicked for all calendars.');
  
    for (const calendar of calendarInfo) {
      try {
        // Sync Google Calendar events to Airtable
        await syncGoogleCalendarToAirtable(
          calendar.id, // Use each calendar's id
          session,
          () => supabase.auth.signOut(),
          setAddedRecords,
          setFailedRecords
        );
        
        // Fetch Google Calendar events to update Airtable with Google Event details
        const googleEvents = await fetchGoogleCalendarEvents(calendar.id, session);
  
        for (const googleEvent of googleEvents) {
          // Ensure event has start and end times
          const { start, end } = ensureTime(googleEvent);
  
          // Format the dates in the required format
          const formattedStartDate = formatDateTime(start);
          const formattedEndDate = formatDateTime(end);
  
          // Prepare the data to update Airtable with Google Calendar event details
          const airtableUpdateRecord = {
            fields: {
              StartDate: formattedStartDate,  // Formatted Start Date
              EndDate: formattedEndDate,      // Formatted End Date
              'Event Title': googleEvent.summary || 'Untitled Event',  // Event Title
              GoogleEventId: googleEvent.id,  // Google Calendar Event ID
              Processed: true,  // Mark as processed
            },
          };
  
          // Update Airtable with Google Calendar event details
          try {
            const response = await fetch(`https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ`, {
              method: 'POST',
              headers: {
                'Authorization': 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(airtableUpdateRecord),
            });
  
            const data = await response.json();
  
            if (response.ok) {
              console.log(`Successfully updated Airtable with Google event: ${googleEvent.summary}`);
            } else {
              console.error(`Failed to update Airtable. Status: ${response.status}`);
              console.error('Error Details:', data);
            }
          } catch (error) {
            console.error(`Error updating Airtable with Google event details: ${error.message}`);
          }
        }
      } catch (error) {
        console.error('Error syncing Google Calendar to Airtable:', error);
      }
    }
  };
  
  

  // Check if access token is still valid
  function isAccessTokenValid() {
    const expirationTime = localStorage.getItem('expiration_time');
    if (!expirationTime) {
      return false;
    }
    return new Date().getTime() < expirationTime;
  }

  useEffect(() => {
    if (session) {
      const refreshTokenAsync = async () => {
        const refresh_token = session.refresh_token;
        const access_token = localStorage.getItem('access_token');

        // Only refresh the token if it's expired
        if (!isAccessTokenValid()) {
          console.log('Access token expired, refreshing...');
          const newAccessToken = await refreshAccessToken(refresh_token);
          if (newAccessToken) {
            await supabase.auth.setSession({ access_token: newAccessToken });
          }
        } else {
          console.log('Access token is still valid, no need to refresh.');
        }
      };

      refreshTokenAsync();
    }
  }, [session, supabase]);

  const getGreeting = () => {
    const currentHour = new Date().getHours();
    if (currentHour < 12) {
      return 'Good morning';
    } else if (currentHour < 18) {
      return 'Good afternoon';
    } else {
      return 'Good evening';
    }
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="App">
      <div className="container">
        <h1>Warranty Calendar</h1>
        <div style={{ width: '100%', margin: '0 auto' }}>
          {session ? (
            <>
              <h2>{getGreeting()} {session.user.email}</h2>
              <hr />
              <button onClick={handleSyncNow}>Sync Now</button> {/* Manual Sync Button */}
              <div className="calendar-grid">
                {calendarInfo.map((calendar) => (
                  <CalendarSection
                    key={calendar.id}
                    calendarId={calendar.id}
                    calendarName={calendar.name}
                    session={session}
                    signOut={() => supabase.auth.signOut()}
                    setAddedRecords={setAddedRecords}
                    setFailedRecords={setFailedRecords}
                    triggerSync={triggerSync}
                    setTriggerSync={setTriggerSync}
                    rateLimitHit={rateLimitHit} // Pass rateLimitHit as prop
                    setRateLimitHit={setRateLimitHit} // Pass setter as prop
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
                </div>
              </div>
              <button onClick={() => supabase.auth.signOut()}>Sign Out</button>
            </>
          ) : (
            <>
              <button onClick={() => supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                  scopes: 'https://www.googleapis.com/auth/calendar',
                  access_type: 'offline',  // Request offline access for refresh token
                  prompt: 'consent'  // Force Google to show consent screen (ensures refresh token is issued)
                }
              })}>
                Sign In With Google
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;