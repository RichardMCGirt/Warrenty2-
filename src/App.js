
import React, { useState, useEffect } from 'react';
import './App.css';
import { useSession, useSupabaseClient} from '@supabase/auth-helpers-react';
let isTerminated = false; // Initialize the variable early in the file


async function processEvents(events, calendarId, session) {
  if (!session || !session.provider_token) {
    console.error('Session or provider token is missing.');
    return;
  }

  for (const event of events) {
    try {
      console.log(`Processing event: ${event.title}`);
      await lockAirtableRecord(event.id);

      const googleEventId = await checkForDuplicateEvent(event, calendarId, session);

      if (!googleEventId) {
        console.log(`Creating a new event for: "${event.title}"`);
        const newGoogleEventId = await createGoogleCalendarEvent(event, calendarId, session);
        if (newGoogleEventId) {
          await updateAirtableWithGoogleEventIdAndProcessed(event.id, newGoogleEventId, true);
        } else {
          console.error(`Failed to create Google Calendar event for: "${event.title}"`);
        }
      } else {
        console.log(`Event already exists. Checking for updates...`);
        const googleEvent = await getGoogleCalendarEvent(googleEventId, calendarId, session);
        if (isEventDifferent(event, googleEvent)) {
          await deleteGoogleCalendarEvent(googleEventId, calendarId, session);
          const newGoogleEventId = await createGoogleCalendarEvent(event, calendarId, session);
          await updateAirtableWithGoogleEventIdAndProcessed(event.id, newGoogleEventId, true);
        } else {
          console.log(`No changes detected for "${event.title}".`);
        }
      }
      await unlockAirtableRecord(event.id);

    } catch (error) {
      console.error(`Error processing event "${event.title}":`, error);
      await unlockAirtableRecord(event.id);
    }
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

// Creates a new Google Calendar event
async function createGoogleCalendarEvent(event, calendarId, session) {
  console.log(`Creating new Google Calendar event for: "${event.title}"...`);

  // Prepare the event object for Google Calendar API
  const updatedEvent = {
      summary: event.title,
      description: event.description,
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
      if (!response.ok) {
          console.error('Failed to create Google Calendar event:', data);
          return null;
      }

      console.log('Event created successfully with ID:', data.id);
      return data.id;
  } catch (error) {
      console.error('Error creating Google Calendar event:', error);
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
  if (isTerminated) {
      console.log('Script is terminated. Skipping fetch for unprocessed events.');
      return [];
  }

  console.log('Fetching unprocessed events from Airtable...');
  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ?filterByFormula=AND(OR({Processed}=FALSE()), NOT({EndDate}=''))`;

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
          b: record.fields['b'] || '',  // ✅ Added the 'b' field here
          processed: record.fields['Processed'] || false
      }));

      console.log("Fetched unprocessed records:", records);
      
      if (records.length === 0) {
          console.log('No unprocessed events found.');
          isTerminated = true;
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


// Check for duplicate Google Calendar events
async function checkForDuplicateEvent(event, calendarId, session) {
  console.log(`Checking for duplicate event for: "${event.title}"`);

  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;
  const timeMin = new Date(event.start).toISOString();
  const timeMax = new Date(event.end).toISOString();

  try {
      const response = await fetch(`${url}?timeMin=${timeMin}&timeMax=${timeMax}`, {
          headers: {
              Authorization: `Bearer ${session.provider_token}`,
          },
      });

      const data = await response.json();
      if (!response.ok) {
          console.error('Failed to fetch events from Google Calendar:', data);
          return null;
      }

      const duplicateEvent = data.items.find(existingEvent =>
          existingEvent.summary === event.title &&
          existingEvent.start.dateTime === event.start.toISOString() &&
          existingEvent.end.dateTime === event.end.toISOString()
      );

      if (duplicateEvent) {
          console.log('Duplicate event found:', duplicateEvent.id);
          return duplicateEvent.id;
      }

      console.log('No duplicate event found.');
      return null;
  } catch (error) {
      console.error('Error checking for duplicate events:', error);
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
          },
      });

      if (!response.ok) {
          console.error('Failed to fetch event from Google Calendar');
          return null;
      }

      const data = await response.json();
      return data;
  } catch (error) {
      console.error('Error fetching Google Calendar event:', error);
      return null;
  }
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
  setNoChangeRecords,
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
  
    
  
  <button onClick={handleSyncNow}>Sync Now</button>


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

function formatCountdown(seconds) {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function App() {
  const calendarMap = {
    Savannah: 'c_ebe1fcbce1be361c641591a6c389d4311df7a97961af0020c889686ae059d20a@group.calendar.google.com',
    Charleston: 'c_d113e252e0e5c8cfbf17a13149707a30d3c0fbeeff1baaac7a46940c2cc448ca@group.calendar.google.com',
    Greensboro: 'c_03867438b82e5dfd8d4d3b6096c8eb1c715425fa012054cc95f8dea7ef41c79b@group.calendar.google.com',
    MyrtleBeach: 'c_ad562073f4db2c47279af5aa40e53fc2641b12ad2497ccd925feb220a0f1abee@group.calendar.google.com',
    Wilmington: 'c_45db4e963c3363676038697855d7aacfd1075da441f9308e44714768d4a4f8de@group.calendar.google.com',
    Grenville: 'c_0476130ac741b9c58b404c737a8068a8b1b06ba1de2a84cff08c5d15ced54edf@group.calendar.google.com',
    Columbia: 'c_df033dd6c81bb3cbb5c6fdfd58dd2931e145e061b8a04ea0c13c79963cb6d515@group.calendar.google.com',
    Raleigh: 'warranty@vanirinstalledsales.com',
  };

  function getTimeUntilNextQuarterHour() {
    const now = new Date();
    const nextQuarterHour = new Date(now);
    nextQuarterHour.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
    return Math.max(0, Math.floor((nextQuarterHour - now) / 1000)); // Return remaining time in seconds
  }

  const supabase = useSupabaseClient();
  const [countdown, setCountdown] = useState(getTimeUntilNextQuarterHour());
  const [calendarEvents, setCalendarEvents] = useState(
    Object.fromEntries(
      Object.entries(calendarMap).map(([calendarName]) => [
        calendarName,
        { added: [], failed: [], noChange: [] },
      ])
    )
  );

  const session = useSession();


  const handleLogin = async () => {
    try {
        await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                scopes: 'https://www.googleapis.com/auth/calendar',
                redirectTo: window.location.origin,
            },
        });
    } catch (error) {
        console.error('Error during login:', error);
    }
};

const handleLogout = async () => {
  try {
      const { error } = await supabase.auth.refreshSession();
      if (error) {
          console.error('Error refreshing session:', error);
      }
      await supabase.auth.signOut();
      console.log('User logged out successfully.');
  } catch (error) {
      console.error('Error during logout:', error);
  }
};



const fetchAndProcessEvents = async () => {
  console.log('Fetching and processing events for all calendars...');

  const updatedCalendarEvents = { ...calendarEvents };

  for (const [calendarName, calendarId] of Object.entries(calendarMap)) {
    console.log(`Processing events for calendar: ${calendarName}`);

    try {
      const events = await fetchUnprocessedEventsFromAirtable();
      console.log(`Fetched ${events.length} unprocessed events from Airtable for calendar: ${calendarName}`);

      const addedEvents = [];

      for (const event of events) {
        try {
          // Check if the event matches the calendar
          if (event.b.toLowerCase().replace(/\s+/g, '') === calendarName.toLowerCase()) {
            console.log(`Creating Google Calendar event for: "${event.title}" on calendar "${calendarName}"`);

            const googleEventId = await createGoogleCalendarEvent(event, calendarId, session);

            if (googleEventId) {
              console.log(`Successfully created Google Calendar event with ID: ${googleEventId} for: "${event.title}"`);
              addedEvents.push(`${event.title} on ${event.start.toISOString().split('T')[0]}`);

              // Mark the record as processed in Airtable
              console.log(`Marking Airtable record "${event.id}" as processed`);
              await updateAirtableWithGoogleEventIdAndProcessed(event.id, googleEventId, true);
            } else {
              console.error(`Failed to create Google Calendar event for: "${event.title}"`);
            }
          } else {
            console.log(`Skipping event "${event.title}" as it doesn't match the calendar "${calendarName}"`);
          }
        } catch (error) {
          console.error(`Error processing event "${event.title}":`, error);
        }
      }

      updatedCalendarEvents[calendarName] = {
        ...updatedCalendarEvents[calendarName],
        added: [...updatedCalendarEvents[calendarName].added, ...addedEvents],
      };
    } catch (error) {
      console.error(`Error processing events for calendar "${calendarName}":`, error);
    }
  }

  console.log('Finished processing events for all calendars.');
  setCalendarEvents(updatedCalendarEvents);
};


function terminateScript() {
  isTerminated = true;
  console.log("Terminating all processes.");
  clearAllTimers();
}

if (typeof isTerminated !== 'undefined' && isTerminated) {
  console.log("Script is terminated. Skipping further actions.");
}

useEffect(() => {
  const getTimeUntilNextQuarterHour = () => {
    const now = new Date();
    const nextQuarterHour = new Date(now);
    nextQuarterHour.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
    return Math.max(0, Math.floor((nextQuarterHour - now) / 1000));
  };

  const interval = setInterval(() => {
    const currentHour = new Date().getHours();
    if (currentHour >= 7 && currentHour <= 17 && !isTerminated) {
      const timeUntilNextSync = getTimeUntilNextQuarterHour();
      setCountdown(timeUntilNextSync);

      if (timeUntilNextSync === 0) {
        fetchAndProcessEvents().then(() => {
          setCountdown(getTimeUntilNextQuarterHour()); // Reset the countdown after syncing
        });
      }
    }
  }, 1000);

  return () => clearInterval(interval);
}, [session]);

return (
  <div className="App">
    <h1>Google Calendar Sync</h1>
    <p>Next sync in: {formatCountdown(countdown)}</p>
    {!session ? (
      <button onClick={handleLogin}>Sign in with Google</button>
    ) : (
      <button onClick={handleLogout}>Logout</button>
    )}
    {session && (
      <>
        <button onClick={fetchAndProcessEvents}>Sync Now</button>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px' }}>
          {Object.entries(calendarEvents).map(([calendarName, { added }]) => (
            <div key={calendarName} className="calendar-section">
              <h2>{calendarName}</h2>
              {added.length > 0 ? (
                <ul>
                  {added.map((event, index) => (
                    <li key={index}>{event}</li>
                  ))}
                </ul>
              ) : (
                <p></p>
              )}
            </div>
          ))}
        </div>
      </>
    )}
  </div>
);
}

export default App;
