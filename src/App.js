import React, { useState, useEffect } from 'react';
import './App.css';
import { useSession, useSupabaseClient, useSessionContext } from '@supabase/auth-helpers-react';

// Helper to debounce API calls
function debounce(fn, delay) {
  let timeoutId;
  return (...args) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
    }, delay);
  };
}

async function createGoogleCalendarEvent(event, calendarId, session, signOut, setRateLimitInfo) {
  console.log(`Attempting to create a new Google Calendar event for calendar: ${calendarId}`, event);

  if (!session.provider_token) {
    console.error('No valid session token available. Logging out.');
    signOut();
    return null;
  }

  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;

  const newEvent = {
    summary: event.title,
    description: `
      ${event.description}
      \nHomeowner Name: ${event.homeownerName}
      \nMaterials Needed: ${event.materialsNeeded || 'Not specified'}
      \nIssue Pictures: ${event.issuePictures}
      \nCompleted Pictures: ${event.completedPictures}
    `,
    start: { dateTime: event.start.toISOString() },
    end: { dateTime: event.end.toISOString() },
    location: `${event.streetAddress}, ${event.city}, ${event.state}, ${event.zipCode}`,
  };

  console.log('Event data being sent to Google Calendar API:', newEvent);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + session.provider_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(newEvent),
    });

    const data = await response.json();
    console.log('Google Calendar API response:', data);

    const remaining = response.headers.get('X-RateLimit-Remaining');
    const limit = response.headers.get('X-RateLimit-Limit');
    const reset = response.headers.get('X-RateLimit-Reset');
    setRateLimitInfo({ remaining, limit, reset });

    if (response.ok) {
      console.log('Event successfully created in Google Calendar with ID:', data.id);
      return data.id;
    } else {
      console.error('Failed to create event:', data);
      if (data.error.code === 401) {
        console.error('Unauthorized - Logging out');
        signOut();
      }
      return null;
    }
  } catch (error) {
    console.error('Error during Google Calendar API request:', error);
    return null;
  }
}

async function updateGoogleCalendarEvent(event, calendarId, eventId, session, signOut, setRateLimitInfo) {
  console.log(`Updating Google Calendar event for ID: ${eventId}`);

  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`;

  const updatedEvent = {
    summary: event.title,
    description: `
      ${event.description}
      \nHomeowner Name: ${event.homeownerName}
      \nMaterials Needed: ${event.materialsNeeded || 'Not specified'}
      \nIssue Pictures: ${event.issuePictures}
      \nCompleted Pictures: ${event.completedPictures}
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
      if (data.error.code === 401) {
        signOut();
      }
      return null;
    }
  } catch (error) {
    console.error('Error during Google Calendar API request:', error);
    return null;
  }
}

async function updateAirtableWithGoogleEventId(airtableRecordId, googleEventId) {
  console.log(`Updating Airtable record ${airtableRecordId} with Google Event ID: ${googleEventId}`);

  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ/${airtableRecordId}`;
  const updateData = {
    fields: {
      GoogleEventId: googleEventId,
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
      console.error('Error updating Airtable with Google Event ID:', data.error);
    } else {
      console.log('Airtable record successfully updated with Google Event ID:', data);
    }
  } catch (error) {
    console.error('Error during Airtable API request:', error);
  }
}

async function fetchAirtableEvents(retryCount = 0) {
  console.log('Fetching events from Airtable...');

  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ`;
  const maxRetries = 1;

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(2, retryCount) * 1000;

        console.warn(`Rate limit hit. Retrying after ${waitTime}ms...`);

        if (retryCount < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          return fetchAirtableEvents(retryCount + 1); // Retry with incremented retry count
        } else {
          throw new Error('Max retries exceeded');
        }
      } else {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    }

    const data = await response.json();
    console.log('Raw Airtable data fetched:', data);

    const filteredRecords = data.records
      .filter((record) => {
        const hasEventName = !!record.fields['Calendar Event Name'];
        const hasStartDate = !!record.fields['StartDate'];
        const hasEndDate = !!record.fields['EndDate'];

        if (!hasEventName || !hasStartDate || !hasEndDate) {
          console.warn(`Record filtered out: ${record.id}`);
          return false;
        }

        return true;
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
        issuePictures: record.fields['Picture(s) of Issue'] ? record.fields['Picture(s) of Issue'].map(pic => pic.url).join(', ') : 'No pictures provided',
        completedPictures: record.fields['Completed Pictures'] ? record.fields['Completed Pictures'].map(pic => pic.url).join(', ') : 'No pictures provided',
        googleEventId: record.fields['GoogleEventId'] || null,
      }));

    console.log(`Airtable events to process: ${filteredRecords.length}`, filteredRecords);
    return filteredRecords;

  } catch (error) {
    console.error('Error fetching events from Airtable:', error);
    if (retryCount < maxRetries) {
      console.log(`Retrying fetch attempt ${retryCount + 1} of ${maxRetries}...`);
      return fetchAirtableEvents(retryCount + 1);
    } else {
      throw error; // Re-throw the error after max retries
    }
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
    if (data.items) {
      const existingEvent = data.items.find(
        (existingEvent) =>
          existingEvent.summary === event.title &&
          existingEvent.location === `${event.streetAddress}, ${event.city}, ${event.state}, ${event.zipCode}`
      );

      return existingEvent ? existingEvent.id : null; // Return the Google Event ID if a match is found
    }
  } catch (error) {
    console.error('Error checking for duplicate events in Google Calendar:', error);
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkIfAirtableRecordExists(eventTitle, eventStart, eventEnd) {
  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ?filterByFormula=AND({Calendar Event Name}="${eventTitle}", {StartDate}="${eventStart.toISOString()}", {EndDate}="${eventEnd.toISOString()}")`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    return data.records.length > 0 ? data.records[0] : null;
  } catch (error) {
    console.error('Error checking Airtable for existing record:', error);
    return null;
  }
}

async function populateGoogleCalendarWithAirtableRecords(
  calendarId,
  calendarName,
  session,
  signOut,
  setAddedRecords,
  setFailedRecords,
  setRateLimitInfo
) {
  console.log(`Starting to populate Google Calendar "${calendarName}" with Airtable records...`);

  const airtableEvents = await fetchAirtableEvents();
  console.log(`Processing ${airtableEvents.length} Airtable events for Google Calendar sync...`);

  const added = [];
  const failed = [];

  for (const event of airtableEvents) {
    console.log(`Processing event "${event.title}"...`);

    if (event.branch.toLowerCase() === 'unknown' || event.branch.toLowerCase() !== calendarName.toLowerCase()) {
      console.log(
        `Skipping event "${event.title}" due to branch "${event.branch}" not matching "${calendarName}" or being "Unknown"`
      );
      continue;
    }

    // Always try to update first
    const existingGoogleEventId = await checkForDuplicateEvent(event, calendarId, session);

    if (existingGoogleEventId) {
      // Update the existing Google Calendar event
      console.log(`Found existing event: "${event.title}". Updating...`);

      const updatedGoogleEventId = await updateGoogleCalendarEvent(
        event,
        calendarId,
        existingGoogleEventId,
        session,
        signOut,
        setRateLimitInfo
      );

      if (updatedGoogleEventId) {
        await updateAirtableWithGoogleEventId(event.id, updatedGoogleEventId);
        added.push({ title: event.title, status: 'Updated in Google Calendar' });
      } else {
        failed.push({ title: event.title, reason: 'Error during update' });
      }
    } else {
      // If no existing event, create a new one
      console.log(`No existing event found for "${event.title}". Creating new...`);

      const googleEventId = await createGoogleCalendarEvent(
        event,
        calendarId,
        session,
        signOut,
        setRateLimitInfo
      );

      if (googleEventId) {
        await updateAirtableWithGoogleEventId(event.id, googleEventId);
        added.push({ title: event.title, status: 'Created in Google Calendar' });
      } else {
        failed.push({ title: event.title, reason: 'Error during creation' });
      }
    }

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

      if (lastSyncTime && now - lastSyncTime < 900000) {
        console.log('Sync skipped. Last sync was less than 15 minutes ago.');
        return;
      }

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
      syncEvents();
    }
  }, [session, signOut, calendarId, calendarName, setAddedRecords, setFailedRecords, setRateLimitInfo, lastSyncTime, triggerSync, setTriggerSync]);

  return (
    <div className="calendar-item">
      <h2>{calendarName}</h2>
    </div>
  );
}

function App() {
  const session = useSession();
  const supabase = useSupabaseClient();
  const { isLoading } = useSessionContext();

  const [addedRecords, setAddedRecords] = useState([]);
  const [failedRecords, setFailedRecords] = useState([]);
  const [rateLimitInfo, setRateLimitInfo] = useState({ remaining: null, limit: null, reset: null });
  const [triggerSync, setTriggerSync] = useState(false);

  const calendarInfo = [
    { id: 'c_ebe1fcbce1be361c641591a6c389d4311df7a97961af0020c889686ae059d20a@group.calendar.google.com', name: 'Savannah' }
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
                    setRateLimitInfo={setRateLimitInfo}
                    triggerSync={triggerSync}
                    setTriggerSync={setTriggerSync}
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
        <li key={index}>
          <strong>{record.title}:</strong> {record.status}
        </li>
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
        <li key={index}>
          <strong>{record.title}:</strong> {record.reason}
        </li>
      ))}
    </ul>
  ) : (
    <p>No records failed.</p>
  )}
</div>

                </div>
              </div>
              <div className="rate-limit-info">
                <h4>Google Calendar API Rate Limit Information:</h4>
                {rateLimitInfo.limit !== null ? (
                  <ul>
                    <li>Limit: {rateLimitInfo.limit}</li>
                    <li>Remaining: {rateLimitInfo.remaining}</li>
                    <li>Reset Time: {new Date(rateLimitInfo.reset * 1000).toLocaleTimeString()}</li>
                  </ul>
                ) : (
                  <p>No rate limit information available.</p>
                )}
              </div>
              <p></p>
              <button onClick={() => supabase.auth.signOut()}>Sign Out</button>
            </>
          ) : (
            <>
              <button onClick={() => supabase.auth.signInWithOAuth({ provider: 'google', options: { scopes: 'https://www.googleapis.com/auth/calendar' } })}>
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
