import React, { useState, useEffect } from 'react';
import './App.css';
import { useSession, useSupabaseClient, useSessionContext } from '@supabase/auth-helpers-react';

// Debounce function to avoid rapid API calls
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

async function createGoogleCalendarEvent(event, calendarId, session, signOut, setRateLimitInfo) {
  console.log('Attempting to create a new Google Calendar event:', event);

  if (!session.provider_token) {
    console.error('No valid session token available. Logging out.');
    signOut();
    return null;
  }

  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;

  const pictureUrlsDescription = event.pictureUrls.length > 0 
    ? 'Pictures of Issue:\n' + event.pictureUrls.join('\n')
    : 'No pictures provided.';

  const newEvent = {
    summary: event.title,
    description: `
      ${event.description ? event.description + '\n' : ''}
      Homeowner Name: ${event.homeownerName}
      Lot Number: ${event.lotNumber}
      Community/Neighborhood: ${event.community}
      Contact Email: ${event.contactEmail}
      Calendar Link: ${event.calendarLink ? event.calendarLink : 'Not Provided'}
      ${pictureUrlsDescription}
    `,
    start: { dateTime: event.start.toISOString() },
    end: { dateTime: event.end.toISOString() },
    location: `${event.streetAddress}, ${event.city}, ${event.state}, ${event.zipCode}`,
  };

  console.log('New event data:', newEvent);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + session.provider_token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(newEvent)
    });

    // Capture rate limit info from headers
    const remaining = response.headers.get('X-RateLimit-Remaining');
    const limit = response.headers.get('X-RateLimit-Limit');
    const reset = response.headers.get('X-RateLimit-Reset');
    setRateLimitInfo({ remaining, limit, reset });

    const data = await response.json();
    console.log('Google Calendar creation response:', data);
    if (data.error) {
      console.error('Error creating event:', data.error);
      if (data.error.code === 401) {
        console.error('Unauthorized - Logging out');
        signOut(); // Logout if unauthorized
      }
      return null;
    } else {
      console.log('New event successfully created:', data);
      return data.id;
    }
  } catch (error) {
    console.error('Error during fetch request:', error);
    return null;
  }
}

async function updateAirtableWithGoogleEventId(airtableRecordId, googleEventId) {
  console.log('Updating Airtable with new Google Event ID:', googleEventId);

  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ/${airtableRecordId}`;
  const updateData = {
    fields: {
      GoogleEventId: googleEventId
    }
  };

  console.log('Airtable update data:', updateData);

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updateData)
    });

    const data = await response.json();
    console.log('Airtable API response for update:', data);
    if (data.error) {
      console.error('Error updating Airtable with Google Event ID:', data.error);
    } else {
      console.log('Airtable record successfully updated:', data);
    }
  } catch (error) {
    console.error('Error during fetch request:', error);
  }
}

async function fetchAirtableEvents(retryCount = 0) {
  console.log('Fetching events from Airtable');

  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ`;
  const maxRetries = 1;

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(2, retryCount) * 1000;

        console.warn(`Rate limit hit. Retrying after ${waitTime}ms...`);

        if (retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, waitTime));
          return fetchAirtableEvents(retryCount + 1);
        } else {
          throw new Error('Max retries exceeded');
        }
      } else {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    }

    const data = await response.json();
    console.log('Fetched data from Airtable:', data);

    return data.records
      .filter(record => record.fields['Calendar Event Name'] && record.fields['startDate'] && record.fields['endDate'])
      .map(record => ({
        id: record.id,
        title: record.fields['Calendar Event Name'] || "Untitled Event",
        start: new Date(record.fields['startDate']),
        end: new Date(record.fields['endDate']),
        description: record.fields['Billable Reason (If Billable)'] || '',
        branch: record.fields['b'] || 'Unknown',
        homeownerName: record.fields['Homeowner Name'] || 'Unknown',
        lotNumber: record.fields['Lot Number'] || 'Unknown',
        community: record.fields['Community/Neighborhood'] || 'Unknown',
        contactEmail: record.fields['Contact Email'] || 'Unknown',
        calendarLink: record.fields['Calendar Link'] || '',
        pictureUrls: record.fields['Picture(s) of Issue']?.map(pic => pic.url) || [],
        streetAddress: record.fields['Street Address'] || 'Unknown',
        city: record.fields['City'] || 'Unknown',
        state: record.fields['State'] || 'Unknown',
        zipCode: record.fields['Zip Code'] || 'Unknown',
        googleEventId: record.fields['GoogleEventId'] || null,
      }));

  } catch (error) {
    console.error('Error fetching events from Airtable:', error);

    if (retryCount < maxRetries) {
      console.log(`Retrying fetch attempt ${retryCount + 1} of ${maxRetries}...`);
      return fetchAirtableEvents(retryCount + 1);
    } else {
      throw error;
    }
  }
}

async function checkForDuplicateEvent(event, calendarId, session) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?timeMin=${event.start.toISOString()}&timeMax=${event.end.toISOString()}`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': 'Bearer ' + session.provider_token,
    },
  });

  const data = await response.json();
  
  if (data.items) {
    return data.items.some(existingEvent =>
      existingEvent.summary === event.title &&
      existingEvent.location === `${event.streetAddress}, ${event.city}, ${event.state}, ${event.zipCode}`
    );
  }

  return false;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function populateGoogleCalendarWithAirtableRecords(calendarId, calendarName, session, signOut, setAddedRecords, setFailedRecords, setRateLimitInfo) {
  console.log(`Populating Google Calendar (${calendarName}) with Airtable records...`);

  const airtableEvents = await fetchAirtableEvents();
  const added = [];
  const failed = [];

  for (const event of airtableEvents) {
    // Skip events where the branch is "Unknown" or does not match the calendar name
    if (event.branch.toLowerCase() === 'unknown' || event.branch.toLowerCase() !== calendarName.toLowerCase()) {
      console.log(`Skipping event "${event.title}" due to branch "${event.branch}" not matching "${calendarName}" or being "Unknown"`);
      continue;
    }

    if (event.googleEventId) {
      console.log(`Skipping already synced event: ${event.title}`);
      continue;
    }

    const isDuplicate = await checkForDuplicateEvent(event, calendarId, session);
    if (isDuplicate) {
      console.log(`Duplicate event found: "${event.title}". Skipping...`);
      failed.push(event.title);
      continue;
    }

    const googleEventId = await createGoogleCalendarEvent(event, calendarId, session, signOut, setRateLimitInfo);
    if (googleEventId) {
      console.log('New Google Event ID created:', googleEventId);
      await updateAirtableWithGoogleEventId(event.id, googleEventId);
      added.push(event.title);
    } else {
      failed.push(event.title);
    }

    // Introduce a delay of 1 second between requests
    await sleep(600000);
  }

  setAddedRecords(prev => [...prev, ...added]);
  setFailedRecords(prev => [...prev, ...failed]);

  console.log(`Finished populating Google Calendar (${calendarName}) with Airtable records.`);
}

function CalendarSection({ calendarId, calendarName, session, signOut, setAddedRecords, setFailedRecords, setRateLimitInfo }) {
  const [lastSyncTime, setLastSyncTime] = useState(null);

  useEffect(() => {
    console.log('Session state:', session);

    const syncEvents = () => {
      const now = new Date();

      // Check if a sync has occurred in the last 15 minutes
      if (lastSyncTime && (now - lastSyncTime) < 450000) {
        console.log('Sync skipped. Last sync was less than 6 minutes ago.');
        return;
      }

      if (session) {
        if (!session.provider_token) {
          console.error('No valid session token found. Logging out.');
          signOut();
          return;
        }

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
            console.log(`Finished syncing Airtable events to Google Calendar (${calendarName})`);
            setLastSyncTime(new Date());  // Update last sync time
          })
          .catch(error => console.error(`Error syncing Airtable to Google Calendar (${calendarName}):`, error));
      }
    };

    // Run syncEvents immediately when the component mounts
    syncEvents();

    // Set up an interval to run syncEvents every 6.6 minutes (900000 ms)
    const intervalId = setInterval(syncEvents, 400000);

    // Clear the interval when the component unmounts
    return () => clearInterval(intervalId);
  }, [session, signOut, calendarId, calendarName, setAddedRecords, setFailedRecords, setRateLimitInfo, lastSyncTime]);

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

  const calendarInfo = [
    { id: 'c_d113e252e0e5c8cfbf17a13149707a30d3c0fbeeff1baaac7a46940c2cc448ca@group.calendar.google.com', name: 'Charleston' },
    { id: 'c_03867438b82e5dfd8d4d3b6096c8eb1c715425fa012054cc95f8dea7ef41c79b@group.calendar.google.com', name: 'Greensboro' },
    { id: 'c_ad562073f4db2c47279af5aa40e53fc2641b12ad2497ccd925feb220a0f1abee@group.calendar.google.com', name: 'Myrtle Beach' },
    { id: 'c_45db4e963c3363676038697855d7aacfd1075da441f9308e44714768d4a4f8de@group.calendar.google.com', name: 'Wilmington' },
    { id: 'https://calendar.google.com/calendar/embed?src=c_0476130ac741b9c58b404c737a8068a8b1b06ba1de2a84cff08c5d15ced54edf%40group.calendar.google.com&ctz=America%2FToronto', name: 'Grenville'},
    { id: 'https://calendar.google.com/calendar/embed?src=c_df033dd6c81bb3cbb5c6fdfd58dd2931e145e061b8a04ea0c13c79963cb6d515%40group.calendar.google.com&ctz=America%2FToronto', name: 'Columbia'},
    { id: 'warranty@vanirinstalledsales.com', name: 'Raleigh' }
  ].sort((a, b) => a.name.localeCompare(b.name));

  const getGreeting = () => {
    const currentHour = new Date().getHours();
    if (currentHour < 12) {
      return "Good morning";
    } else if (currentHour < 18) {
      return "Good afternoon";
    } else {
      return "Good evening";
    }
  };

  const handleManualSync = async () => {
    if (!session) return;
    
    for (const calendar of calendarInfo) {
      await populateGoogleCalendarWithAirtableRecords(
        calendar.id,
        calendar.name,
        session,
        () => supabase.auth.signOut(),
        setAddedRecords,
        setFailedRecords,
        setRateLimitInfo
      );
    }
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="App">
      <div className="container">
        <h1>Warranty Calendar</h1>
        <div style={{ width: "100%", margin: "0 auto" }}>
          {session ?
            <>
              <h2>{getGreeting()} {session.user.email}</h2>
              <hr />
              <div className="calendar-grid">
                {calendarInfo.map(calendar => (
                  <CalendarSection
                    key={calendar.id}
                    calendarId={calendar.id}
                    calendarName={calendar.name}
                    session={session}
                    signOut={() => supabase.auth.signOut()}
                    setAddedRecords={setAddedRecords}
                    setFailedRecords={setFailedRecords}
                    setRateLimitInfo={setRateLimitInfo}
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
              <button onClick={handleManualSync}>Sync Data Now</button>
              <p></p>
              <button onClick={() => supabase.auth.signOut()}>Sign Out</button>
            </>
            :
            <>
              <button onClick={() => supabase.auth.signInWithOAuth({ provider: 'google', options: { scopes: 'https://www.googleapis.com/auth/calendar' } })}>
                Sign In With Google
              </button>
            </>
          }
        </div>
      </div>
    </div>
  );
}

export default App;