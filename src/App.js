import React, { useState, useEffect } from 'react';
import './App.css';
import { useSession, useSupabaseClient, useSessionContext } from '@supabase/auth-helpers-react';
import { CircularProgressbar } from 'react-circular-progressbar'; // Make sure this package is installed

// Function to fetch and count unprocessed records from Airtable
async function countAirtableRecords() {
  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ?filterByFormula=OR(NOT({Processed}), {GoogleEventId} != BLANK())`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`Error fetching records from Airtable: HTTP ${response.status}`);
      return 0;
    }

    const data = await response.json();
    const recordCount = data.records.length;
    console.log(`Total unprocessed records: ${recordCount}`);

    return recordCount; // Return the count of unprocessed records
  } catch (error) {
    console.error('Error fetching records from Airtable:', error);
    return 0;
  }
}

async function createGoogleCalendarEvent(event, calendarId, session, setRateLimitHit, retryCount = 0) {
  const MAX_RETRIES = 3; // Define a maximum number of retries
  const RETRY_DELAY = 2000 * Math.pow(2, retryCount); // Exponential backoff

  console.log(`Creating Google Calendar event for calendar: ${calendarId}`, event);

  // Check if the event already exists in Google Calendar
  const existingGoogleEventId = await checkForDuplicateEvent(event, calendarId, session);
  if (existingGoogleEventId) {
    console.log('Duplicate event found in Google Calendar, skipping creation:', existingGoogleEventId);
    return existingGoogleEventId; // Skip creation and return the existing event ID
  }

  // If no duplicates are found, proceed with event creation
  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;
  const updatedEvent = {
    summary: event.title,
    description: `${event.description?.trim() || 'No description provided.'}
      \nLocation: ${event.location || 'Not specified'}
      \nHomeowner Name: ${event.homeownerName || 'Not specified'}
      \nMaterials Needed: ${event.materialsNeeded || 'Not specified'}`,
    start: { dateTime: event.start.toISOString() },
    end: { dateTime: event.end.toISOString() },
    location: `${event.streetAddress || ''}, ${event.city || ''}, ${event.state || ''}, ${event.zipCode || ''}`,
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

    if (response.status === 429) { // Rate limit error
      console.error('Rate limit exceeded. Retrying...');
      setRateLimitHit(true);

      if (retryCount < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY)); // Wait before retrying
        return createGoogleCalendarEvent(event, calendarId, session, setRateLimitHit, retryCount + 1); // Retry with increased count
      } else {
        console.error('Max retries reached. Event creation failed due to rate limit.');
        return null;
      }
    }

    const data = await response.json();
    if (response.ok) {
      console.log('Event created successfully with ID:', data.id);
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
      Processed: true,
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
async function fetchAirtableEvents(retryCount = 0) {
  console.log('Fetching unprocessed events from Airtable...');
  
  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ?filterByFormula=OR(NOT({Processed}), {GoogleEventId} != BLANK())&pageSize=100`; // Airtable page size limit is 100
  let allRecords = [];
  let offset = null;

  try {
    do {
      const response = await fetch(`${url}${offset ? `&offset=${offset}` : ''}`, {
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
      offset = data.offset || null; // If there's an offset, continue fetching the next page
      allRecords = [...allRecords, ...data.records]; // Append new records to the allRecords array

      console.log(`Fetched ${data.records.length} records, total so far: ${allRecords.length}`);

    } while (offset && allRecords.length > 100); // Stop looping if total records are 100 or fewer

    const filteredRecords = allRecords
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
          existingEvent.location === `${event.streetAddress}, ${event.city}, ${event.state}, ${event.zipCode}` && // Match location
          existingEvent.start.dateTime === event.start.toISOString() && // Match start time
          existingEvent.end.dateTime === event.end.toISOString() // Match end time
      );

      if (existingEvent) {
        return existingEvent.id; // Return the ID if duplicate is found
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
  setRateLimitHit,
  setNoChangeRecords,
  setChangedRecords
) {
  console.log(`Starting to populate Google Calendar "${calendarName}" with Airtable records...`);

  const airtableEvents = await fetchAirtableEvents();
  const totalFetchedRecords = airtableEvents.length;

  let createdEventsCount = 0;
  const added = [];
  const failed = [];
  const changed = [];
  const noChange = [];
  const processedRecordIds = new Set();

  for (const event of airtableEvents) {
    if (processedRecordIds.has(event.id)) {
      console.log(`Skipping already processed event ID: ${event.id}`);
      continue;
    }

    try {
      // Lock the record to prevent concurrent modifications
      await lockAirtableRecord(event.id);
      console.log(`Locked record for event "${event.title}" with ID: ${event.id}`);

      let googleEventId = event.googleEventId;

      if (googleEventId) {
        console.log(`Event "${event.title}" already has a GoogleEventId: ${googleEventId}. Verifying...`);

        const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${googleEventId}`;
        const googleEventResponse = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: 'Bearer ' + session.provider_token,
            'Content-Type': 'application/json',
          },
        });

        if (googleEventResponse.ok) {
          const googleEvent = await googleEventResponse.json();

          const isEventChanged =
            googleEvent.summary.trim() !== event.title.trim() ||
            new Date(googleEvent.start.dateTime).getTime() !== event.start.getTime() ||
            new Date(googleEvent.end.dateTime).getTime() !== event.end.getTime() ||
            googleEvent.location.trim() !== `${event.streetAddress.trim()}, ${event.city.trim()}, ${event.state.trim()}, ${event.zipCode.trim()}`;

          if (isEventChanged) {
            console.log(`Event "${event.title}" has changed. Deleting and recreating in Google Calendar.`);
            const deleteUrl = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${googleEventId}`;
            const deleteResponse = await fetch(deleteUrl, {
              method: 'DELETE',
              headers: {
                Authorization: 'Bearer ' + session.provider_token,
                'Content-Type': 'application/json',
              },
            });

            if (deleteResponse.ok) {
              console.log(`Deleted old event: ${googleEventId}`);
              googleEventId = await createGoogleCalendarEvent(event, calendarId, session, setRateLimitHit);
              if (googleEventId) {
                await updateAirtableWithGoogleEventIdAndProcessed(event.id, googleEventId, true);
                changed.push(event.title);
                createdEventsCount++;
              } else {
                failed.push(event.title);
              }
            } else {
              console.error(`Failed to delete old event: ${googleEventId}`);
              failed.push(event.title);
            }
          } else {
            console.log(`No changes detected for event "${event.title}".`);
            noChange.push(event.title);
          }
        } else if (googleEventResponse.status === 404) {
          console.log(`Event "${event.title}" was deleted from Google Calendar. Recreating...`);
          googleEventId = await createGoogleCalendarEvent(event, calendarId, session, setRateLimitHit);
          if (googleEventId) {
            await updateAirtableWithGoogleEventIdAndProcessed(event.id, googleEventId, true);
            added.push(event.title);
            createdEventsCount++;
          } else {
            failed.push(event.title);
          }
        }
      } else {
        console.log(`Creating a new Google Calendar event for "${event.title}".`);
        googleEventId = await createGoogleCalendarEvent(event, calendarId, session, setRateLimitHit);
        if (googleEventId) {
          await updateAirtableWithGoogleEventIdAndProcessed(event.id, googleEventId, true);
          added.push(event.title);
          createdEventsCount++;
        } else {
          failed.push(event.title);
        }
      }

      processedRecordIds.add(event.id);
    } catch (error) {
      console.error(`Error processing event "${event.title}":`, error);
      failed.push(event.title);
    }

    await unlockAirtableRecord(event.id);
    await sleep(1000); // Prevent hitting rate limits
  }

  setAddedRecords((prev) => [...prev, ...added]);
  setFailedRecords((prev) => [...prev, ...failed]);
  setChangedRecords(changed);
  setNoChangeRecords(noChange);

  console.log(`Total number of events created: ${createdEventsCount}`);
  console.log(`Total number of records processed: ${processedRecordIds.size}`);
  console.log('Finished populating Google Calendar with Airtable records.');
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
  handleSyncNow  // Add the handleSyncNow prop here
}) {
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const syncEvents = async () => {
      if (!isWithinTimeRange()) {
        console.log("Syncing is allowed only between 6:45 AM and 10:00 PM. Current time is outside this range.");
        return; // Exit if outside the allowed time range
      }

      console.log('Attempting to sync events...');
      if (session && triggerSync) {
        setProgress(0); // Reset progress
        if (!session.provider_token) {
          console.error('No valid session token found. Logging out.');
          signOut();
          return;
        }
        console.log('Session valid. Initiating sync...');
        
        await populateGoogleCalendarWithAirtableRecords(
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
          (current, total) => {
            setProgress((current / total) * 100);
          }
        )
        .then(async () => {
          console.log(`Finished syncing events to Google Calendar "${calendarName}"`);
          await removeDuplicateEvents(); // Check for duplicates after syncing
          setLastSyncTime(new Date()); // Set last sync time to current date/time
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
  ]);

  return (
    <div className="calendar-item">
      <h2>{calendarName}</h2>
      {lastSyncTime && <p>Last sync: {lastSyncTime.toLocaleString()}</p>}
      {progress > 0 && <p>Sync progress: {progress.toFixed(0)}%</p>}
  
      {!isWithinTimeRange() && (
        <p style={{ color: 'red' }}>Syncing is allowed only between 6:45 AM and 10:00 PM. Please try again later.</p>
      )}
  
      {isWithinTimeRange() && (
        <button onClick={handleSyncNow}>Sync Now</button> 
      )}
    </div>
  );
}





async function batchUpdateAirtableRecords(records, batchSize = 10) {
  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ`;
  
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    try {
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ records: batch }),
      });

      const data = await response.json();
      if (!response.ok) {
        console.error('Error updating Airtable records:', data.error); // Handle the error
      } else {
        console.log('Batch successfully updated:', data);
      }
    } catch (error) {
      console.error('Error during Airtable API request:', error);
    }
  }
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



async function uncheckAllProcessedRecords() {
  console.log('Unchecking all processed records in Airtable...');

  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ`;
  const filterFormula = `Processed = TRUE()`;

  try {
    const response = await fetch(`${url}?filterByFormula=${encodeURIComponent(filterFormula)}`, {
      headers: {
        'Authorization': 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (data.records && data.records.length > 0) {
      const batchUpdates = data.records.map(record => ({
        id: record.id,
        fields: { Processed: false }
      }));

      // Call batch update function with batchUpdates array
      await batchUpdateAirtableRecords(batchUpdates, 10); // Specify the batch size
    } else {
      console.log('No processed records to uncheck.');
    }
  } catch (error) {
    console.error('Error unchecking processed records:', error);
  }
}
const FIFTEEN_MINUTES = 15 * 60 * 1000;  // 15 minutes in milliseconds

function App() {
  const session = useSession();
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
        }
      });
    } catch (loginError) {
      console.error('Error during login:', loginError);
    }
  };

  // Automatically log out user if no authorization or token times out
  const handleAuthorizationFailure = () => {
    console.error('Authorization failed or session timed out. Logging out...');
    supabase.auth.signOut(); // Log out the user
  };

  // Automatically login on startup
  useEffect(() => {
    if (!session) {
      console.log('No session detected.');
    }
  }, [session]);

  // Helper function to format time
  const formatTime = (time) => {
    const minutes = Math.floor(time / 60000);
    const seconds = Math.floor((time % 60000) / 1000);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`; // Ensure seconds are always two digits
  };

  // Countdown logic
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
    // Ensure session exists and session.user is available
    if (!session || !session.user) {
      return 'Hello, Guest'; // Provide a fallback for users who are not logged in
    }

    const currentHour = new Date().getHours();
    let name = session.user.email.split('@')[0];  // Get the part of the email before '@'
    name = name.replace(/\./g, ' ');  // Replace periods with spaces

    // Capitalize first and last names
    name = name
      .split(' ')  // Split the name into words
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))  // Capitalize first letter of each word
      .join(' ');  // Join the words back into a string

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
        <h1></h1>
        <h2>{getGreeting()}</h2> 

        <h3 style={{ fontSize: '16px', textAlign: 'center' }}>Time Until Next Sync</h3>

        {/* Show the timer and sync only if user is logged in */}
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
                    fontSize: '25px', // Adjust font size as needed
                    fill: '#000', // Change text color if needed
                    dominantBaseline: 'middle', // Center vertically
                    textAnchor: 'middle', // Center horizontally
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
                    signOut={() => supabase.auth.signOut()}
                    setAddedRecords={setAddedRecords}
                    setFailedRecords={setFailedRecords}
                    triggerSync={triggerSync}
                    setTriggerSync={setTriggerSync}
                    rateLimitHit={rateLimitHit}
                    setRateLimitHit={setRateLimitHit}        
                    setNoChangeRecords={setNoChangeRecords}
                    setChangedRecords={setChangedRecords}
                    handleSyncNow={handleSyncNow}  
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
