import React, { useState, useEffect } from 'react';
import './App.css';
import { useSession, useSupabaseClient, useSessionContext } from '@supabase/auth-helpers-react';

const clientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;
const clientSecret = process.env.REACT_APP_GOOGLE_CLIENT_SECRET;

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

async function updateGoogleCalendarEvent(event, calendarId, eventId, session, signOut, setRateLimitInfo = () => {}, setRateLimitHit) {
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

  console.log('Event data being sent to Google Calendar for update:', updatedEvent);

  try {
    const response = await fetch(url, {
      method: 'PATCH',
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
    const remaining = response.headers.get('X-RateLimit-Remaining');
    const limit = response.headers.get('X-RateLimit-Limit');
    const reset = response.headers.get('X-RateLimit-Reset');
    console.log(`Rate limit info: remaining=${remaining}, limit=${limit}, reset=${reset}`);
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

async function fetchAirtableEvents() {
  console.log('Fetching unprocessed events from Airtable...');

  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ?filterByFormula=OR(NOT({Processed}), {GoogleEventId} != BLANK())`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
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
        processed: record.fields['Processed'] || false,
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
  const [lastSynced, setLastSynced] = useState(null);
  const [tokenExpiryTime, setTokenExpiryTime] = useState(null);

  const calendarInfo = [{ id: 'c_ebe1fcbce1be361c641591a6c389d4311df7a97961af0020c889686ae059d20a@group.calendar.google.com', name: 'Savannah' }];

  useEffect(() => {
    if (session?.expires_at) {
      setTokenExpiryTime(session.expires_at);
    }

    const interval = setInterval(async () => {
      const currentTime = Math.floor(Date.now() / 1000);

      if (tokenExpiryTime && currentTime >= tokenExpiryTime) {
        console.log('Token expired, refreshing...');
        const newTokenData = await refreshAccessToken(session.refresh_token, clientId, clientSecret);
        if (newTokenData) {
          setTokenExpiryTime(currentTime + newTokenData.expiresIn);
          session.provider_token = newTokenData.accessToken;
        } else {
          console.error('Unable to refresh token, logging out.');
          supabase.auth.signOut();
        }
      }
    }, 5 * 60 * 1000); // Check every 5 minutes

    return () => clearInterval(interval);
  }, [session, tokenExpiryTime, supabase]);

  const handleSyncNow = () => {
    console.log('Manual sync button clicked.');
    setTriggerSync(true);
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
              <h2>Welcome {session.user.email}</h2>
              <hr />
              <button onClick={handleSyncNow}>Sync Now</button>
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
                    rateLimitHit={rateLimitHit}
                    setRateLimitHit={setRateLimitHit}
                    lastSynced={lastSynced}
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
            <button
              onClick={() =>
                supabase.auth.signInWithOAuth({
                  provider: 'google',
                  options: {
                    scopes: 'https://www.googleapis.com/auth/calendar',
                  },
                })
              }
            >
              Sign In With Google
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
