import React, { useState, useEffect } from 'react';
import './App.css';
import { useSession, useSupabaseClient, useSessionContext } from '@supabase/auth-helpers-react';

const clientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;
const clientSecret = process.env.REACT_APP_GOOGLE_CLIENT_SECRET;

async function fetchAverageLastUpdated() {
  console.log('Fetching LastUpdated timestamps for calculating the average...');
  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ?fields[]=LastUpdated`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`Error fetching LastUpdated timestamps from Airtable: HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    const lastUpdatedTimestamps = data.records
      .filter((record) => record.fields['LastUpdated'])
      .map((record) => new Date(record.fields['LastUpdated']).getTime());

    if (lastUpdatedTimestamps.length === 0) {
      return null;
    }

    const averageTimestamp = lastUpdatedTimestamps.reduce((a, b) => a + b, 0) / lastUpdatedTimestamps.length;
    const averageDate = new Date(averageTimestamp);

    console.log(`Average LastUpdated: ${averageDate}`);
    return averageDate;
  } catch (error) {
    console.error('Error fetching and calculating the average LastUpdated:', error);
    return null;
  }
}

// Function to display the last sync time in a human-readable format
function formatAverageLastUpdated(date) {
  if (!date) return 'Never';
  return date.toLocaleString(); // Customize this if you want a different date format
}

// Function to check for duplicate events in Google Calendar
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

      if (existingEvent) {
        const fieldsToCheck = ['summary', 'description', 'start', 'end', 'location'];
        const isDifferent = fieldsToCheck.some((field) => {
          const eventField = field === 'start' || field === 'end' ? event[field].toISOString() : event[field];
          const existingEventField = field === 'start' || field === 'end' ? existingEvent[field].dateTime : existingEvent[field];
          return eventField !== existingEventField;
        });

        return isDifferent ? existingEvent.id : null;
      }
    }
  } catch (error) {
    console.error('Error checking for duplicate events in Google Calendar:', error);
    return null;
  }

  return null;
}

// Function to refresh the Google OAuth token
async function refreshAccessToken(refreshToken, clientId, clientSecret) {
  const url = 'https://oauth2.googleapis.com/token';

  const params = new URLSearchParams();
  params.append('client_id', clientId);
  params.append('client_secret', clientSecret);
  params.append('refresh_token', refreshToken);
  params.append('grant_type', 'refresh_token');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (response.ok) {
      const data = await response.json();
      return {
        accessToken: data.access_token,
        expiresIn: data.expires_in,
      };
    } else {
      console.error('Failed to refresh token', await response.json());
      return null;
    }
  } catch (error) {
    console.error('Error refreshing token:', error);
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
) {
  console.log(`Updating Google Calendar event for ID: ${eventId}`);

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
async function lockAirtableRecord(airtableRecordId) {
  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ/${airtableRecordId}`;
  const updateData = {
    fields: {
      Processed: true, // Mark record as being processed
    },
  };

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238', // Use your actual API key here
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updateData),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Error locking Airtable record:', errorData);
      return; // Stop further execution if there's an error
    }

    console.log(`Locked record ${airtableRecordId} for processing`);
  } catch (error) {
    console.error(`Failed to lock record ${airtableRecordId}`, error);
  }
}

async function unlockAirtableRecord(airtableRecordId) {
  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ/${airtableRecordId}`;

  const updateData = {
    fields: {
      Processed: false, // Uncheck 'Processed' field after sync
    },
  };

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238', // Use your actual API key here
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updateData),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Error unlocking Airtable record:', data.error);
      return; // Stop further execution if there's an error
    }

    console.log(`Unlocked record ${airtableRecordId} and unchecked 'Processed'`);
  } catch (error) {
    console.error(`Failed to unlock record ${airtableRecordId}`, error);
  }
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
      let googleEventId;

      if (event.googleEventId) {
        console.log(`Event "${event.title}" already has a GoogleEventId: ${event.googleEventId}. Verifying in Google Calendar...`);

        const existingGoogleEventId = await checkForDuplicateEvent(event, calendarId, session);

        if (existingGoogleEventId) {
          googleEventId = await updateGoogleCalendarEvent(
            event,
            calendarId,
            existingGoogleEventId,
            session,
            signOut,
            setRateLimitInfo,
            setRateLimitHit
          );
        } else {
          console.log(`No duplicate found for event "${event.title}". Skipping update.`);
        }
      } else {
        googleEventId = await createGoogleCalendarEvent(
          event,
          calendarId,
          session,
          signOut,
          setRateLimitInfo,
          setRateLimitHit
        );
      }

      if (googleEventId) {
        console.log('Updating Airtable with Google Event ID:', googleEventId);
        await updateAirtableWithGoogleEventIdAndProcessed(event.id, googleEventId);
        added.push(event.title);
      } else {
        failed.push(event.title);
      }

      // Delay of 2 seconds before unlocking the record
      await sleep(2000); // 2-second delay
      
      // Unlock the record and uncheck the 'Processed' field
      await unlockAirtableRecord(event.id);
      
    } catch (error) {
      console.error(`Error processing event "${event.title}":`, error);
      failed.push(event.title);
    }
  }

  setAddedRecords((prev) => [...prev, ...added]);
  setFailedRecords((prev) => [...prev, ...failed]);

  console.log(`Finished populating Google Calendar "${calendarName}" with Airtable records.`);
}

// Utility function to simulate a delay (for rate-limiting purposes)
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createGoogleCalendarEvent(event, calendarId, session, signOut, setRateLimitInfo = () => {}, setRateLimitHit) {
  console.log(`Attempting to create a new Google Calendar event for calendar: ${calendarId}`, event);

  const existingGoogleEventId = await checkForDuplicateEvent(event, calendarId, session);
  if (existingGoogleEventId) {
    console.log('Duplicate event detected in final check, skipping creation:', existingGoogleEventId);
    return existingGoogleEventId;
  }

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
        Authorization: `Bearer ${session.provider_token}`,
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
      await updateAirtableWithGoogleEventIdAndProcessed(event.id, data.id);
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

async function updateAirtableWithGoogleEventIdAndProcessed(airtableRecordId, googleEventId) {
  console.log(`Updating Airtable record ${airtableRecordId} with Google Event ID: ${googleEventId}`);

  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ/${airtableRecordId}`;

  const updateData = {
    fields: {
      GoogleEventId: googleEventId,
      Processed: true,
      LastUpdated: new Date().toISOString(),
    },
  };

  console.log('Data being sent to Airtable for update:', updateData);

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

    // Get the current date
    const now = new Date();
    const startOfToday = new Date(now.setHours(0, 0, 0, 0)); // Start of the current day

    // Filter records to include only those where StartDate is today or in the future
    const filteredRecords = data.records
      .filter((record) => {
        // Ensure the event has a name, start, and end dates
        if (!record.fields['Calendar Event Name'] || !record.fields['StartDate'] || !record.fields['EndDate']) {
          return false;
        }

        const startDate = new Date(record.fields['StartDate']);
        // Only include records with a StartDate that is today or in the future
        return startDate >= startOfToday;
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



function CalendarSection({ calendarId, calendarName, session, signOut, setAddedRecords, setFailedRecords, setRateLimitInfo, triggerSync, setTriggerSync, rateLimitHit, setRateLimitHit, lastSynced }) {
  useEffect(() => {
    if (triggerSync) {
      console.log(`Syncing calendar: ${calendarName}`);
      populateGoogleCalendarWithAirtableRecords(
        calendarId,
        calendarName,
        session,
        signOut,
        setAddedRecords,
        setFailedRecords,
        setRateLimitInfo,
        rateLimitHit,
        setRateLimitHit
      ).then(() => {
        setTriggerSync(false);
      });
    }
  }, [triggerSync, calendarId, calendarName, session, signOut, setAddedRecords, setFailedRecords, setRateLimitInfo, rateLimitHit, setRateLimitHit]);

  return (
    <div className="calendar-item">
      <h2>{calendarName}</h2>
      <p>Last synced: {lastSynced ? lastSynced.toLocaleString() : 'Never'}</p>
    </div>
  );
}

function App() {
  const session = useSession();
  const supabase = useSupabaseClient();
  const { isLoading } = useSessionContext();

  const [addedRecords, setAddedRecords] = useState([]);
  const [failedRecords, setFailedRecords] = useState([]);
  const [triggerSync, setTriggerSync] = useState(false);
  const [rateLimitHit, setRateLimitHit] = useState(false);
  const [averageLastUpdated, setAverageLastUpdated] = useState(null);

  const calendarInfo = [
    { id: 'c_ebe1fcbce1be361c641591a6c389d4311df7a97961af0020c889686ae059d20a@group.calendar.google.com', name: 'Savannah' },
  ].sort((a, b) => a.name.localeCompare(b.name));

  const handleSyncNow = () => {
    console.log('Manual sync button clicked.');
    setTriggerSync(true); // Trigger manual sync
  };

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

  useEffect(() => {
    // Fetch and display the average LastUpdated time when the app loads
    const fetchAndSetAverageLastUpdated = async () => {
      const averageDate = await fetchAverageLastUpdated();
      setAverageLastUpdated(averageDate);
    };
    fetchAndSetAverageLastUpdated();
  }, []);

  useEffect(() => {
    if (!triggerSync) return;

    console.log('Triggering sync process...');

    const syncEvents = async () => {
      for (const calendar of calendarInfo) {
        console.log(`Syncing calendar: ${calendar.name}`);
        await populateGoogleCalendarWithAirtableRecords(
          calendar.id,
          calendar.name,
          session,
          () => supabase.auth.signOut(),
          setAddedRecords,
          setFailedRecords,
          () => {}, // Replace with rate limit function if needed
          rateLimitHit,
          setRateLimitHit
        );
      }

      // After sync, recalculate and update the average LastUpdated time
      const newAverageDate = await fetchAverageLastUpdated();
      setAverageLastUpdated(newAverageDate);
    };

    syncEvents().finally(() => setTriggerSync(false));
  }, [triggerSync]);

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
              <p>Last Synced: {formatAverageLastUpdated(averageLastUpdated)}</p> {/* Display average LastUpdated */}
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
                },
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
