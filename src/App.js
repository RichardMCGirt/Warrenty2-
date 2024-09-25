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

    console.log('Response status:', response.status); // Log the response status

    if (response.status === 429) {
      console.error('Rate limit reached. Stopping further requests.');
      const limitInfo = {
        remaining: response.headers.get('X-RateLimit-Remaining'),
        limit: response.headers.get('X-RateLimit-Limit'),
        reset: response.headers.get('X-RateLimit-Reset'),
      };
      console.log('Rate limit info:', limitInfo);
      setRateLimitHit(true);
      return null;
    }

    const data = await response.json();
    console.log('Google API response data:', data); // Log the entire response

    if (response.ok) {
      console.log('Event successfully created in Google Calendar with ID:', data.id);

      // Update Airtable with the Google Event ID
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



async function updateGoogleCalendarEvent(
  event,
  calendarId,
  eventId,
  session,
  signOut,
  setRateLimitInfo = () => {},
  setRateLimitHit = () => {}
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

  console.log('Event data being sent to update Google Calendar API:', updatedEvent);

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer ' + session.provider_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatedEvent),
    });

    console.log('Response status:', response.status); // Log response status

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      console.error(`Rate limit reached. Retry after ${retryAfter} seconds.`);
      setRateLimitHit(true);
    
      // Retry logic
      if (retryAfter) {
        setTimeout(() => {
          // Call the function again after the retry period
          createGoogleCalendarEvent(event, calendarId, session, signOut, setRateLimitInfo, setRateLimitHit);
        }, retryAfter * 1000); // Retry after the time specified in the header
      }
      return null;
    }
    

    const data = await response.json();
    console.log('Response headers:', response.headers); // Log response headers
    console.log('Response data:', data); // Log response body

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

function formatDateToCustomString(date) {
  const options = {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: true, // Use 12-hour time with AM/PM
  };

  return new Intl.DateTimeFormat('en-US', options).format(date);
}


async function updateAirtableWithGoogleEventIdAndProcessed(airtableRecordId, googleEventId) {
  console.log(`Updating Airtable record ${airtableRecordId} with Google Event ID: ${googleEventId} and marking as processed`);

  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ/${airtableRecordId}`;

  // Format the current date in custom MM/DD/YYYY hh:mm am/pm format
  const formattedDate = formatDateToCustomString(new Date());

  // Ensure data matches Airtable fields exactly
  const updateData = {
    fields: {
      GoogleEventId: googleEventId,  // Ensure this matches the Airtable field name exactly
      Processed: true,               // Ensure this is a boolean if Airtable expects a checkbox
      LastUpdated: formattedDate,    // Use the custom formatted date string
    },
  };

  // Log the formatted date and updateData object to ensure it's correct
  console.log('Formatted LastUpdated date:', formattedDate);
  console.log('Data being sent to Airtable:', JSON.stringify(updateData, null, 2));  // Pretty print the data for better readability

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',  // Replace with your actual API key
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updateData),
    });

    console.log('Response status:', response.status); // Log the response status
    const data = await response.json();
    
    // Log the response data for further inspection
    console.log('Response data:', JSON.stringify(data, null, 2));

    if (!response.ok) {
      // Log more details when there is an error
      console.error('Error updating Airtable:', data.error);  // Inspect the error
    } else {
      console.log('Airtable record successfully updated:', JSON.stringify(data, null, 2));
    }
  } catch (error) {
    // Log full error information
    console.error('Error during Airtable API request:', error);
    console.error('Error stack trace:', error.stack);
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

async function checkForDuplicateEvent(event, calendarId, session, signOut) {
  if (!session || !session.provider_token) {
    console.error('No valid session token found. User must sign in again.');
    signOut(); // Ensure signOut is called
    return null;
  }

  console.log('Session provider token:', session.provider_token); // Debugging token

  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?timeMin=${event.start.toISOString()}&timeMax=${event.end.toISOString()}`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: 'Bearer ' + session.provider_token,
      },
    });

    // Check for 401 Unauthorized and handle it
    if (response.status === 401) {
      console.error('Unauthorized access, likely due to an expired token. Signing out...');
      signOut(); // Use the signOut function passed down
      return null;
    }

    const data = await response.json();
    console.log('Google Calendar API response:', data);

    if (data.items && data.items.length > 0) {
      const existingEvent = data.items.find(
        (existingEvent) =>
          existingEvent.summary === event.title && // Match title
          existingEvent.location === `${event.streetAddress}, ${event.city}, ${event.state}, ${event.zipCode}` // Match location
      );

      if (existingEvent) {
        console.log('Found existing event:', existingEvent);
        return existingEvent.id;
      }
    }
  } catch (error) {
    console.error('Error checking for duplicate events in Google Calendar:', error);
  }

  return null;
}


async function fetchGoogleCalendarEvents(calendarId, session, timeMin, timeMax) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?timeMin=${timeMin}&timeMax=${timeMax}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: 'Bearer ' + session.provider_token,
      },
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch events from Google Calendar');
    }
    
    const data = await response.json();
    return data.items || [];
  } catch (error) {
    console.error('Error fetching events from Google Calendar:', error);
    return [];
  }
}

function compareAndUpdateEvent(airtableEvent, googleEvent, session, calendarId, signOut, setRateLimitInfo, setRateLimitHit) {
  // Compare fields to detect changes
  const hasChanges = (
    airtableEvent.title !== googleEvent.summary ||
    airtableEvent.description !== googleEvent.description ||
    airtableEvent.start.toISOString() !== googleEvent.start.dateTime ||
    airtableEvent.end.toISOString() !== googleEvent.end.dateTime ||
    airtableEvent.location !== googleEvent.location
  );
  
  if (hasChanges) {
    // Update the Google Calendar event
    return updateGoogleCalendarEvent(
      airtableEvent,
      calendarId,
      googleEvent.id,
      session,
      signOut,
      setRateLimitInfo,
      setRateLimitHit
    );
  } else {
    console.log(`No changes detected for event: ${airtableEvent.title}`);
    return Promise.resolve(null); // No changes, no update
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
  setUpdatedRecords,
  setRateLimitInfo,
  rateLimitHit,
  setRateLimitHit
) {
  console.log(`Starting to populate Google Calendar "${calendarName}" with Airtable records...`);
  
  const airtableEvents = await fetchAirtableEvents();
  console.log(`Processing ${airtableEvents.length} Airtable events for Google Calendar sync...`);
  
  const timeMin = new Date().toISOString(); // Specify the start of the time range (e.g., now)
  const timeMax = new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString(); // One year from now
  
  const googleCalendarEvents = await fetchGoogleCalendarEvents(calendarId, session, timeMin, timeMax);
  console.log(`Fetched ${googleCalendarEvents.length} Google Calendar events for comparison.`);
  
  const added = [];
  const failed = [];
  const updated = []; // Track updated events

  for (const event of airtableEvents) {
    if (rateLimitHit) {
      console.log(`Rate limit hit. Stopping further processing.`);
      break;
    }

    console.log(`Processing event "${event.title}"...`);
    
    const matchingGoogleEvent = googleCalendarEvents.find(
      (googleEvent) => googleEvent.summary === event.title && googleEvent.start.dateTime === event.start.toISOString()
    );
    
    if (matchingGoogleEvent) {
      console.log(`Found matching event in Google Calendar: "${event.title}". Comparing for updates...`);
      const googleEventId = await compareAndUpdateEvent(
        event,
        matchingGoogleEvent,
        session,
        calendarId,
        signOut,
        setRateLimitInfo,
        setRateLimitHit
      );
      
      if (googleEventId) {
        updated.push(event.title); // If updated, add to updated records
      }
    } else {
      console.log(`No matching event found for "${event.title}". Creating new event in Google Calendar...`);
      const googleEventId = await createGoogleCalendarEvent(
        event,
        calendarId,
        session,
        signOut,
        setRateLimitInfo,
        setRateLimitHit
      );
      
      if (googleEventId) {
        added.push(event.title);
      } else {
        failed.push(event.title);
      }
    }
  }
  
  setAddedRecords((prev) => [...prev, ...added]);
  setFailedRecords((prev) => [...prev, ...failed]);
  setUpdatedRecords((prev) => [...prev, ...updated]);
  
  console.log(`Finished populating Google Calendar "${calendarName}" with Airtable records.`);
}


function CalendarSection({
  calendarId,
  calendarName,
  session,
  signOut,
  setAddedRecords,
  setFailedRecords,
  setUpdatedRecords, // Pass setUpdatedRecords
  setRateLimitInfo,
  triggerSync,
  setTriggerSync
}) {
  const [lastSyncTime, setLastSyncTime] = useState(null);

  useEffect(() => {
    const syncEvents = () => {
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
          setUpdatedRecords, // Pass updated records setter
          setRateLimitInfo
        )
          .then(() => {
            console.log(`Finished syncing events to Google Calendar "${calendarName}"`);
            setLastSyncTime(new Date());
            setTriggerSync(false);
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
  }, [session, signOut, calendarId, calendarName, setAddedRecords, setFailedRecords, setUpdatedRecords, setRateLimitInfo, lastSyncTime, triggerSync, setTriggerSync]);

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
  const [updatedRecords, setUpdatedRecords] = useState([]);
  const [triggerSync, setTriggerSync] = useState(false);
  const [rateLimitHit, setRateLimitHit] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(900); // 15 minutes countdown (900 seconds)

  const calendarInfo = [
    { id: 'c_ebe1fcbce1be361c641591a6c389d4311df7a97961af0020c889686ae059d20a@group.calendar.google.com', name: 'Savannah' }
  ];

  // Function to handle the sync process
  const handleSyncNow = () => {
    console.log('Manual sync button clicked.');
    setTriggerSync(true);
    setTimeRemaining(900); // Reset the countdown after manual sync
  };

  // Countdown Timer
  useEffect(() => {
    const countdownInterval = setInterval(() => {
      setTimeRemaining((prevTime) => {
        if (prevTime <= 0) {
          setTriggerSync(true); // Trigger the sync when the countdown reaches 0
          return 900; // Reset the countdown to 15 minutes
        }
        return prevTime - 1;
      });
    }, 1000); // Decrease the countdown by 1 second

    // Cleanup the interval when the component unmounts
    return () => clearInterval(countdownInterval);
  }, []);

  // Automatically trigger sync every 15 minutes (triggerSync is set to true after countdown reaches 0)
  useEffect(() => {
    if (triggerSync && session) {
      console.log('Auto-sync triggered.');
      populateGoogleCalendarWithAirtableRecords(
        calendarInfo[0].id,
        calendarInfo[0].name,
        session,
        () => supabase.auth.signOut(),
        setAddedRecords,
        setFailedRecords,
        setUpdatedRecords,
        () => {}, // Set rate limit info (optional)
        rateLimitHit,
        setRateLimitHit
      ).then(() => {
        setTriggerSync(false);
      });
    }
  }, [triggerSync, session]);

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

  // Convert seconds to minutes and seconds for display
  const formatTimeRemaining = () => {
    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  return (
    <div className="App">
      <div className="container">
        <h1>Warranty Calendar</h1>
        <div style={{ width: '100%', margin: '0 auto' }}>
          {session ? (
            <>
              <h2>{getGreeting()} {session.user.email}</h2>
              <hr />
              <button onClick={handleSyncNow}>Sync Now</button>
              <p>Next auto-sync in: {formatTimeRemaining()}</p> {/* Countdown Timer Display */}
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
                    setUpdatedRecords={setUpdatedRecords}
                    triggerSync={triggerSync}
                    setTriggerSync={setTriggerSync}
                    rateLimitHit={rateLimitHit}
                    setRateLimitHit={setRateLimitHit}
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
                  <div className="updated-records">
                    <h4>Successfully Updated Records:</h4>
                    {updatedRecords.length > 0 ? (
                      <ul>
                        {updatedRecords.map((record, index) => (
                          <li key={index}>{record}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>No records updated.</p>
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
                  scopes: 'https://www.googleapis.com/auth/calendar'
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
