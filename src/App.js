import React, { useState, useEffect } from 'react';
import './App.css';
import { useSession, useSupabaseClient, useSessionContext } from '@supabase/auth-helpers-react';
import { jwtDecode } from 'jwt-decode';  // Correct named import

function isTokenExpired(token) {
  // Decode the token to check expiration time (e.g., using jwt-decode library or manual decoding)
  const decodedToken = jwtDecode(token);
  const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds
  return decodedToken.exp < currentTime;
}


async function refreshGoogleToken() {
  const refreshToken = localStorage.getItem('google_refresh_token');
  
  if (!refreshToken) {
    console.error('No refresh token found, user might need to reauthenticate.');
    return;
  }

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: 'YOUR_GOOGLE_CLIENT_ID',
        client_secret: 'YOUR_GOOGLE_CLIENT_SECRET',
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    const data = await response.json();

    if (response.ok) {
      // Update the access token and store it
      localStorage.setItem('google_access_token', data.access_token);
      console.log('Access token refreshed successfully.');
      return data.access_token;
    } else {
      console.error('Failed to refresh token:', data);
      return null;
    }
  } catch (error) {
    console.error('Error refreshing token:', error);
    return null;
  }
}

async function getGoogleAccessToken() {
  const token = localStorage.getItem('google_access_token');
  
  // Check if token needs to be refreshed (implement your token expiration check here)
  if (!token || isTokenExpired(token)) {
    console.log('Access token expired, refreshing token...');
    const refreshedToken = await refreshGoogleToken();
    return refreshedToken || null;
  }

  return token;
}

async function createGoogleCalendarEvent(event, calendarId, session, signOut, setRateLimitInfo, setRateLimitHit) {
  const accessToken = await getGoogleAccessToken();
  
  if (!accessToken) {
    console.error('Failed to obtain access token.');
    return;
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

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatedEvent),
    });

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




async function checkAndSyncEvent(event, calendarId, session, signOut, setRateLimitInfo, setRateLimitHit) {
  console.log(`Checking and syncing event for calendar: ${calendarId}`, event);

  // Check if the event exists in Google Calendar
  const existingGoogleEventId = await checkForDuplicateEvent(event, calendarId, session);
  
  if (existingGoogleEventId) {
    console.log(`Event already exists with Google Calendar ID: ${existingGoogleEventId}. Checking for updates...`);

    // Update the event if needed
    const googleEventId = await updateGoogleCalendarEvent(
      event,
      calendarId,
      existingGoogleEventId,
      session,
      signOut,
      setRateLimitInfo,
      setRateLimitHit
    );

    if (googleEventId) {
      console.log(`Google Calendar event updated: ${googleEventId}`);
      return googleEventId;
    } else {
      console.log('No changes needed or failed to update.');
      return existingGoogleEventId;
    }

  } else {
    console.log('Event does not exist in Google Calendar. Creating new event...');

    // Create a new event in Google Calendar
    const newGoogleEventId = await createGoogleCalendarEvent(
      event,
      calendarId,
      session,
      signOut,
      setRateLimitInfo,
      setRateLimitHit
    );

    if (newGoogleEventId) {
      console.log(`New Google Calendar event created: ${newGoogleEventId}`);
      return newGoogleEventId;
    } else {
      console.error('Failed to create new Google Calendar event.');
      return null;
    }
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
  
  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ/${airtableRecordId}`;

  // Ensure data matches Airtable fields exactly
  const updateData = {
    fields: {
      GoogleEventId: googleEventId,  // Ensure this matches the Airtable field name exactly
      Processed: true,               // Ensure this is a boolean if Airtable expects a checkbox
      LastUpdated: new Date().toISOString(),  // Ensure this is in proper date format
    },
  };

  console.log('Data being sent to Airtable:', updateData);  // Debug the data being sent

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',  // Replace with your actual API key
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updateData),
    });

    const data = await response.json();
if (!response.ok) {
  console.error('Error updating Airtable:', data.error);  // Inspect the error
} else {
      console.log('Airtable record successfully updated:', data);
    }
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
    console.log(`Locked record ${airtableRecordId} for Processed`);
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
        // Check for field differences
        const fieldsToCheck = ['summary', 'description', 'start', 'end', 'location'];
        const isDifferent = fieldsToCheck.some((field) => {
          const eventField = field === 'start' || field === 'end' ? event[field].toISOString() : event[field];
          const existingEventField = field === 'start' || field === 'end' ? existingEvent[field].dateTime : existingEvent[field];
          return eventField !== existingEventField;
        });

        // If there's a difference, trigger an update
        return isDifferent ? existingEvent.id : null;
      }
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

  // Define `added` and `failed` arrays here
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

        // Only proceed if existingGoogleEventId is not null
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
        // Check Google Calendar for an existing event to avoid duplicates
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

        // Update Airtable with the Google Event ID and mark as processed
        await updateAirtableWithGoogleEventIdAndProcessed(event.id, googleEventId);
        added.push(event.title);
      } else {
        failed.push(event.title);
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
  setTriggerSync,
  supabase // Pass supabase instance as a prop
}) {
  const [lastSyncTime, setLastSyncTime] = useState(null);

  useEffect(() => {
    const accessToken = localStorage.getItem('google_access_token');
    
    // Check if the access token exists in localStorage
    if (!accessToken) {
      // Redirect to Google login if no token is found
      supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          scopes: 'https://www.googleapis.com/auth/calendar',
          access_type: 'offline', // Allows for refresh tokens
        },
      });
    }
  }, [supabase]);

  useEffect(() => {
    const syncEvents = () => {
      console.log('Session valid. Initiating sync...');
      
      // Start syncing events from Airtable to Google Calendar
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
          setLastSyncTime(new Date()); // Update the last sync time
          setTriggerSync(false); // Reset the sync trigger
        })
        .catch((error) => {
          console.error(`Error syncing Airtable to Google Calendar "${calendarName}":`, error);
        });
    };

    // If manual sync is triggered, initiate the sync process
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
    lastSyncTime,
    triggerSync,
    setTriggerSync,
  ]);

  return (
    <div className="calendar-item">
      <h2>{calendarName}</h2>
    </div>
  );
}



function App() {
  const session = useSession(); // Automatically handles session persistence
  const supabase = useSupabaseClient(); // Get the supabase instance
  
  const { isLoading } = useSessionContext();

  const [addedRecords, setAddedRecords] = useState([]);
  const [failedRecords, setFailedRecords] = useState([]);
  const [triggerSync, setTriggerSync] = useState(false);
  const [rateLimitHit, setRateLimitHit] = useState(false); // Move this here

  const calendarInfo = [
    { id: 'c_ebe1fcbce1be361c641591a6c389d4311df7a97961af0020c889686ae059d20a@group.calendar.google.com', name: 'Savannah' },
    { id: 'c_d113e252e0e5c8cfbf17a13149707a30d3c0fbeeff1baaac7a46940c2cc448ca@group.calendar.google.com', name: 'Charleston' },
    { id: 'c_03867438b82e5dfd8d4d3b6096c8eb1c715425fa012054cc95f8dea7ef41c79b@group.calendar.google.com', name: 'Greensboro' },
    { id: 'c_0476130ac741b9c58b404c737a8068a8b1b06ba1de2a84cff08c5d15ced54edf@group.calendar.google.com', name: 'Greenville' },
    { id: 'c_ad562073f4db2c47279af5aa40e53fc2641b12ad2497ccd925feb220a0f1abee@group.calendar.google.com', name: 'Myrtle Beach' },
    { id: 'warranty@vanirinstalledsales.com', name: 'Raleigh' },
    { id: 'c_45db4e963c3363676038697855d7aacfd1075da441f9308e44714768d4a4f8de@group.calendar.google.com', name: 'Wilmington' }
  ].sort((a, b) => a.name.localeCompare(b.name));

  // Add the useEffect to store the Google access token on sign in
  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') {
        // Store both access token and refresh token in localStorage
        localStorage.setItem('google_access_token', session.provider_token);
        localStorage.setItem('google_refresh_token', session.refresh_token);
      }
    });
  
    // Ensure that subscription is not undefined before calling unsubscribe
    return () => {
      if (subscription && typeof subscription.unsubscribe === 'function') {
        subscription.unsubscribe(); 
      }
    };
  }, [supabase]);
  
  
  const handleSyncNow = () => {
    console.log('Manual sync button clicked.');
    setTriggerSync(true); // Trigger manual sync
  };

  // Automatically trigger sync every 30 minutes
  useEffect(() => {
    const syncInterval = setInterval(() => {
      console.log('Automatically triggering sync...');
      handleSyncNow();
    }, 30 * 60 * 1000); // 30 minutes in milliseconds

    // Cleanup the interval when the component is unmounted
    return () => clearInterval(syncInterval);
  }, []); // Empty dependency array means this runs only once on mount

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
                    supabase={supabase} // Pass the supabase instance
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
                  access_type: 'offline',  // This allows for refresh tokens
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
