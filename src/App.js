
import React, { useState, useEffect } from 'react';
import './App.css';
import { useSession, useSupabaseClient} from '@supabase/auth-helpers-react';
let isTerminated = false; // Initialize the variable early in the file
let processedRecords = new Set(); // Store processed records to prevent duplicates

function normalizeDateTime(dateStr) {
  return new Date(dateStr).toISOString().split(".")[0] + "Z"; // Removes milliseconds
}


async function fetchWithRetry(url, options, retries = 3, delay = 10000) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return await response.json(); // Return data if successful

      const errorData = await response.json();
      if (errorData.error?.status === "PERMISSION_DENIED" && errorData.error?.message.includes("Quota exceeded")) {
        console.warn(`Quota exceeded. Retrying in ${delay / 1000} seconds...`);
        await new Promise(res => setTimeout(res, delay));
      } else {
        console.error("API request failed:", errorData);
        return null;
      }
    } catch (error) {
      console.error("Network error during fetch:", error);
      await new Promise(res => setTimeout(res, delay));
    }
  }
  console.error("Max retries reached. API request failed.");
  return null;
}


async function fetchGoogleCalendarEvents(calendarId, session) {
  console.log(`Fetching events from Google Calendar for calendar ID: ${calendarId}`);

  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${session.provider_token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Failed to fetch Google Calendar events:', errorData);
      return [];
    }

    const data = await response.json();
    return data.items || []; // Return an empty array if no events are found
  } catch (error) {
    console.error('Error fetching Google Calendar events:', error);
    return [];
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
  if (isTerminated) {
    console.log("🛑 Script is terminated. Skipping event creation.");
    return null;
  }

  console.log(`🚀 Checking for duplicate event: "${event.title}"`);
  const duplicateEventId = await checkForDuplicateEvent(event, calendarId, session);

  if (duplicateEventId) {
    console.log(`⚠️ Skipping creation: Event "${event.title}" already exists in Google Calendar.`);
    return duplicateEventId;
  }

  console.log(`🚀 Creating new Google Calendar event for: "${event.title}"...`);

  // ✅ Ensure proper date formatting
  const startDate = event.start ? new Date(event.start).toISOString() : null;
  const endDate = event.end ? new Date(event.end).toISOString() : null;

  if (!startDate || !endDate) {
    console.error(`❌ Invalid start or end date for event "${event.title}":`, { startDate, endDate });
    return null;
  }

  // ✅ Ensure location is properly defined
  const location = [event.streetAddress, event.city, event.state, event.zipCode]
    .filter(Boolean)
    .join(", ");


  // ✅ Create the event object
  const newEvent = {
    summary: event.title,
    description: event.description || "No description provided",
    start: { dateTime: startDate, timeZone: "America/Toronto" },
    end: { dateTime: endDate, timeZone: "America/Toronto" },
    location: location || "Unknown Location",
  };

  // ✅ Log event details for debugging
  console.log("📝 Event Details:");
  console.log(`- Title: ${event.title}`);
  console.log(`- Description: ${newEvent.description}`);
  console.log(`- Start Time: ${startDate}`);
  console.log(`- End Time: ${endDate}`);
  console.log(`- Location: ${newEvent.location}`);

  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;

  try {
    const options = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.provider_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(newEvent),
    };
    
    const data = await fetchWithRetry(url, options);
    

    console.log(`✅ Event created successfully: "${event.title}" (ID: ${data.id})`);
    return data.id;
  } catch (error) {
    console.error('❌ Error creating Google Calendar event:', error);
    return null;
  }
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
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString().split("T")[0]; // Extracts YYYY-MM-DD format
  
  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ?filterByFormula=OR(IS_AFTER({FormattedStartDate}, '${todayISO}'), {FormattedStartDate}='${todayISO}')`;
  
  try {
    const options = {
      headers: {
              Authorization: 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
              'Content-Type': 'application/json',
            },
          };
          
          const data = await fetchWithRetry(url, options);

          const records = data.records.map((record) => ({
            id: record.id,
            title: record.fields['Lot Number and Community/Neighborhood'] || 'No lot number',
            start: new Date(record.fields['FormattedStartDate']),
            end: new Date(record.fields['FormattedEndDate']),
            description: record.fields['Description of Issue'] || '',
            b: record.fields['b'] || '',  // ✅ Added the 'b' field here
            processed: record.fields['Processed'] || false,
            location: [
                record.fields['Street Address'],
                record.fields['City'],
                record.fields['State'],
                record.fields['Zip Code']
            ].filter(Boolean).join(', ')  // ✅ Joins fields with a comma, removing any empty values
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
  console.log(`Checking for duplicate event: "${event.title}"`);

  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;

  // ✅ Ensure dates are in correct ISO format
  const timeMin = event.start ? new Date(event.start).toISOString() : null;
  const timeMax = event.end ? new Date(event.end).toISOString() : null;

  if (!timeMin || !timeMax) {
    console.error(`❌ Invalid date detected for event "${event.title}":`, { timeMin, timeMax });
    return null;
  }

  try {
    const response = await fetch(
      `${url}?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`,
      {
        headers: {
          Authorization: `Bearer ${session.provider_token}`,
        },
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      console.error('❌ Failed to fetch events from Google Calendar:', errorData);
      return null;
    }

    const data = await response.json();
    console.log(`📌 Fetched ${data.items?.length || 0} events from Google Calendar for duplicate check.`);

    // 🛑 Validate event data before processing
    if (!data.items || data.items.length === 0) {
      console.log(`✅ No duplicate event found for: "${event.title}".`);
      return null;
    }

    // More precise duplicate detection using title and start/end times
    const duplicateEvent = data.items.find(existingEvent => {
      if (!existingEvent.start?.dateTime || !existingEvent.end?.dateTime) {
        console.warn(`⚠️ Skipping event due to missing start or end time:`, existingEvent);
        return false; // Change from skipping to returning false
    }
    

      const googleStart = normalizeDateTime(existingEvent.start.dateTime);
      const googleEnd = normalizeDateTime(existingEvent.end.dateTime);
      const normalizeText = (text) => text.trim().replace(/\s+/g, ' ').toLowerCase();


      return (
        normalizeText(existingEvent.summary) === normalizeText(event.title) &&
        googleStart === timeMin &&
        googleEnd === timeMax
      );
    });

    if (duplicateEvent) {
      console.log(`🚨 Duplicate event found: "${event.title}", ID: ${duplicateEvent.id}`);
      return duplicateEvent.id;
    }

    console.log(`✅ No duplicate event found for: "${event.title}".`);
    return null;
  } catch (error) {
    console.error('❌ Error checking for duplicate events:', error);
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

  const airtableEvents = await fetchUnprocessedEventsFromAirtable();
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

        // 🛑 **Ensure we completely skip updates if no changes exist**
        if (!isEventDifferent(event, googleEvent)) {
          console.log(`✅ No changes detected for event "${event.title}". Skipping update.`);
          noChange.push(event.title);
          processedRecordIds.add(event.id);
          await unlockAirtableRecord(event.id);
          continue;  // 🚀 Skip everything, including calling updateGoogleCalendarEvent
        }

        console.log(`⚠️ Updating event "${event.title}" as it has changed.`);
        await updateGoogleCalendarEvent(
          googleEventId,
          event.title,
          event.start,
          event.end,
          calendarId,
          session
        );
        await updateAirtableWithGoogleEventIdAndProcessed(event.id, googleEventId, true);
      } else {
        console.log(`Creating new event: ${event.title}`);
        googleEventId = await createGoogleCalendarEvent(event, calendarId, session);
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
    await sleep(12000);  // Delay to avoid hitting rate limits
  }

  setAddedRecords((prev) => [...prev, ...added]);
  setFailedRecords((prev) => [...prev, ...failed]);
  setNoChangeRecords(noChange);

  console.log(`Total number of events created: ${createdEventsCount}`);
  console.log(`Total number of records processed for calendar "${calendarName}": ${processedRecordIds.size}`);
}




function isEventDifferent(airtableEvent, googleEvent) {
  if (!airtableEvent || !googleEvent || !googleEvent.start || !googleEvent.end) {
    console.error('❌ Missing required event data:', { airtableEvent, googleEvent });
    return true; // Consider it different if any required data is missing
  }

  // ✅ Function to safely convert date strings to ISO format
  function safeNormalizeToISO(dateStr) {
    if (!dateStr) return null;
    
    let date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      console.error(`❌ Invalid Date: ${dateStr}`);
      return null;
    }

   // return date.toISOString(); // Converts to strict "YYYY-MM-DDTHH:mm:ss.sssZ"
  }

  // ✅ Convert both Google and Airtable dates safely
  const googleStart = safeNormalizeToISO(googleEvent.start.dateTime || googleEvent.start.date);
  const googleEnd = safeNormalizeToISO(googleEvent.end.dateTime || googleEvent.end.date);
  const airtableStart = safeNormalizeToISO(airtableEvent.start);
  const airtableEnd = safeNormalizeToISO(airtableEvent.end);

  // ✅ Check if any date conversion failed
  if (!googleStart || !googleEnd || !airtableStart || !airtableEnd) {
    console.error("❌ One or more event dates are invalid:", {
      airtableStart, airtableEnd, googleStart, googleEnd,
      airtableEvent, googleEvent
    });
    return true; // Treat as different if any date is invalid
  }

  // ✅ Compare event fields safely
  const isTitleDifferent = (airtableEvent.title || "").trim().toLowerCase() !== (googleEvent.summary || "").trim().toLowerCase();
  const isStartDifferent = airtableStart !== googleStart;
  const isEndDifferent = airtableEnd !== googleEnd;
  const isDescriptionDifferent = (airtableEvent.description || "").trim() !== (googleEvent.description || "").trim();
  const isLocationDifferent = (airtableEvent.location || "").trim() !== (googleEvent.location || "").trim();

  // ✅ Log differences
  console.log("🔍 Comparing Events (ISO Normalized):", {
    isTitleDifferent,
    isStartDifferent,
    isEndDifferent,
    isDescriptionDifferent,
    isLocationDifferent,
    airtableStart,
    googleStart,
    airtableEnd,
    googleEnd
  });

  return isTitleDifferent || isStartDifferent || isEndDifferent || isDescriptionDifferent || isLocationDifferent;
}


async function updateGoogleCalendarEvent(eventId, title, start, end, calendarId, session) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`;

  try {
      // Fetch the original event details before updating
      const originalResponse = await fetch(url, {
          method: 'GET',
          headers: {
              Authorization: `Bearer ${session.provider_token}`,
              'Content-Type': 'application/json',
          },
      });

      if (!originalResponse.ok) {
          const errorData = await originalResponse.json();
          console.error('❌ Failed to fetch original Google Calendar event:', errorData);
          return;
      }

      const originalEvent = await originalResponse.json();
      const originalStart = originalEvent.start?.dateTime || originalEvent.start?.date;
      const originalEnd = originalEvent.end?.dateTime || originalEvent.end?.date;
      const originalTimeZone = originalEvent.start?.timeZone || "America/New_York"; // Default if missing

      // ✅ Convert everything to strict ISO format before comparing
      const normalizeToISO = (dateStr) => {
          if (!dateStr) return null;
          return new Date(dateStr).toISOString();
      };

      const normalizedOriginalStart = normalizeToISO(originalStart);
      const normalizedOriginalEnd = normalizeToISO(originalEnd);
      const normalizedNewStart = normalizeToISO(start);
      const normalizedNewEnd = normalizeToISO(end);

      console.log('🔵 Original Event Data (Normalized):', {
          title: originalEvent.summary,
          start: normalizedOriginalStart,
          end: normalizedOriginalEnd,
          timeZone: originalTimeZone,
      });

      console.log("🟡 Updated Event Data Before Sending (Normalized):", {
          summary: title,
          start: normalizedNewStart,
          end: normalizedNewEnd,
          startTimeZone: originalTimeZone,
          endTimeZone: originalTimeZone,
      });

      // ✅ Ensure comparison uses strict ISO format
      if (normalizedNewStart === normalizedOriginalStart && normalizedNewEnd === normalizedOriginalEnd) {
          console.log("✅ No change in start or end time. Skipping update.");
          return; // 🚀 Exit function early to prevent unnecessary update
      }

      console.log("⚠️ Detected a change in start or end time. Proceeding with update.");

      // Proceed with updating the event
      const updatedEvent = {
          summary: title,
          start: {
              dateTime: normalizedNewStart, 
              timeZone: originalTimeZone, 
          },
          end: {
              dateTime: normalizedNewEnd, 
              timeZone: originalTimeZone,
          },
      };

      const options = {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${session.provider_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updatedEvent),
      };
      
      // Use fetchWithRetry to handle rate limits
      const apiResponse = await fetchWithRetry(url, options);

      if (!apiResponse) {
          console.error("❌ Failed to update Google Calendar event: API call failed after retries.");
          return;
      }

      console.log(`✅ Successfully updated Google Calendar event: ${title}`);
  } catch (error) {
      console.error('❌ Error updating Google Calendar event:', error);
  }
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
      console.error(`Failed to fetch event from Google Calendar: ${eventId}`);
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

async function removeDuplicateEvents(calendarId, session) {
  console.log(`Checking for duplicate events in calendar: ${calendarId}...`);

  try {
    const events = await fetchGoogleCalendarEvents(calendarId, session);

    if (!events || events.length === 0) {
      console.log("No events found in calendar.");
      return;
    }

    const eventMap = new Map();
    const duplicateEvents = [];

    events.forEach(event => {
      const eventKey = `${event.summary.toLowerCase().trim()}_${new Date(event.start.dateTime || event.start.date).toISOString()}`;

      if (eventMap.has(eventKey)) {
        duplicateEvents.push(event); // Store duplicates
      } else {
        eventMap.set(eventKey, event);
      }
    });

    // Log all detected duplicates
    if (duplicateEvents.length > 0) {
      console.log("🚨 Found duplicate events:", duplicateEvents.map(e => ({
        title: e.summary,
        start: e.start.dateTime || e.start.date,
        id: e.id
      })));
    } else {
      console.log("✅ No duplicate events found.");
    }

    // Remove duplicates
    for (const event of duplicateEvents) {
      await deleteGoogleCalendarEvent(event.id, calendarId, session);
      console.log(`🗑️ Deleted duplicate event: ${event.summary} (ID: ${event.id})`);
    }

  } catch (error) {
    console.error(`Error removing duplicate events for calendar ID "${calendarId}":`, error);
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
  const session = useSession();
  const [countdown, setCountdown] = useState(getTimeUntilNextQuarterHour());
  const [calendarEvents, setCalendarEvents] = useState(
    Object.fromEntries(
      Object.entries(calendarMap).map(([calendarName]) => [
        calendarName,
        { added: [], failed: [], noChange: [] },
      ])
    )
  );



  function isEventDifferent(airtableEvent, googleEvent) {
    const isTitleDifferent = airtableEvent.title !== googleEvent.summary;
    const isStartDifferent = new Date(airtableEvent.start).toISOString() !== googleEvent.start.dateTime;
    const isEndDifferent = new Date(airtableEvent.end).toISOString() !== googleEvent.end.dateTime;
    const isDescriptionDifferent = (airtableEvent.description || '') !== (googleEvent.description || '');
    const isLocationDifferent = (airtableEvent.location || '') !== (googleEvent.location || '');
  
    return isTitleDifferent || isStartDifferent || isEndDifferent || isDescriptionDifferent || isLocationDifferent;
  }
  
  
  async function fetchGoogleCalendarEvents(calendarId, session) {
    console.log(`Fetching events from Google Calendar for calendar ID: ${calendarId}`);
  
    // ✅ Define the base API URL
    const calendarApiUrl = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;
  
    // ✅ Get today's date in ISO format at midnight UTC
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const timeMin = today.toISOString(); // Filters out past events
  
    // ✅ Construct the API URL with filtering for only future events
    const url = `${calendarApiUrl}?timeMin=${encodeURIComponent(timeMin)}&maxResults=250&orderBy=startTime&singleEvents=true`;
  
    console.log(`Fetching events from Google Calendar: ${url}`);
  
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${session.provider_token}`,
          'Content-Type': 'application/json',
        },
      });
  
      if (!response.ok) {
        const errorData = await response.json();
        console.error('Failed to fetch Google Calendar events:', errorData);
        return [];
      }
  
      const data = await response.json();
      return data.items || []; // Return an empty array if no events are found
    } catch (error) {
      console.error('Error fetching Google Calendar events:', error);
      return [];
    }
  }
  
  
  
  
  async function updateGoogleCalendarEvent(eventId, title, start, end, calendarId, session) {
    const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`;

    try {
        // Fetch the original event details before updating
        const originalResponse = await fetch(url, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${session.provider_token}`,
                'Content-Type': 'application/json',
            },
        });

        if (!originalResponse.ok) {
            const errorData = await originalResponse.json();
            console.error('Failed to fetch original Google Calendar event:', errorData);
            return;
        }

        const originalEvent = await originalResponse.json();
        const originalStart = originalEvent.start?.dateTime || originalEvent.start?.date;
        const originalEnd = originalEvent.end?.dateTime || originalEvent.end?.date;
        const originalTimeZone = originalEvent.start?.timeZone || "America/New_York"; // Default if missing

        // ✅ Convert everything to strict ISO format before comparing
        const normalizeToISO = (dateStr) => {
            if (!dateStr) return null;
            return new Date(dateStr).toISOString();
        };

        const normalizedOriginalStart = normalizeToISO(originalStart);
        const normalizedOriginalEnd = normalizeToISO(originalEnd);
        const normalizedNewStart = normalizeToISO(start);
        const normalizedNewEnd = normalizeToISO(end);

        console.log('🔵 Original Event Data (Normalized):', {
            title: originalEvent.summary,
            start: normalizedOriginalStart,
            end: normalizedOriginalEnd,
            timeZone: originalTimeZone,
        });

        console.log("🟡 Updated Event Data Before Sending (Normalized):", {
            summary: title,
            start: normalizedNewStart,
            end: normalizedNewEnd,
            startTimeZone: originalTimeZone,
            endTimeZone: originalTimeZone,
        });

        // ✅ Ensure comparison uses strict ISO format
        if (normalizedNewStart === normalizedOriginalStart && normalizedNewEnd === normalizedOriginalEnd) {
            console.log("✅ No change in start or end time. Skipping update.");
            return; // 🚀 Exit function early to prevent unnecessary update
        }

        console.log("⚠️ Detected a change in start or end time. Proceeding with update.");

        // Proceed with updating the event
        const updatedEvent = {
            summary: title,
            start: {
                dateTime: normalizedNewStart, 
                timeZone: originalTimeZone, 
            },
            end: {
                dateTime: normalizedNewEnd, 
                timeZone: originalTimeZone,
            },
        };

        const options = {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${session.provider_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updatedEvent),
        };
        
        // Use fetchWithRetry to handle rate limits
        const apiResponse = await fetchWithRetry(url, options);
if (!apiResponse) {
  console.error("API call failed after retries.");
  return;
}

        

if (!apiResponse) {
  console.error("❌ Failed to update Google Calendar event: API call failed after retries.");
  return;
}

console.log(`✅ Successfully updated Google Calendar event: ${title}`);

    } catch (error) {
        console.error('Error updating Google Calendar event:', error);
    }
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

async function fetchAndProcessEvents() {
  console.log("🚀 Fetching and processing events for all calendars...");

  if (isTerminated) {
    console.log("🛑 Script is terminated. Skipping event processing.");
    return;
  }

  let allCalendarsProcessed = true;
  let updatedCalendarEvents = {}; // To store the latest added events

  for (const [calendarName, calendarId] of Object.entries(calendarMap)) {
    console.log(`📅 Processing events for calendar: ${calendarName}`);

    try {
      const airtableEvents = await fetchUnprocessedEventsFromAirtable();
      const filteredAirtableEvents = airtableEvents.filter(event =>
        event.b?.toLowerCase().trim().replace(/\s+/g, '') === calendarName.toLowerCase().trim()
      );

      if (filteredAirtableEvents.length === 0) {
        console.log(`✅ No unprocessed events found for ${calendarName}. Skipping.`);
        continue;
      }

      console.log(`📊 Filtered ${filteredAirtableEvents.length} events from Airtable for calendar: ${calendarName}`);
      const googleCalendarEvents = await fetchGoogleCalendarEvents(calendarId, session);
      console.log(`📊 Fetched ${googleCalendarEvents.length} events from Google Calendar: ${calendarName}`);

      const googleEventMap = new Map();
      googleCalendarEvents.forEach(event => {
        googleEventMap.set(event.summary?.toLowerCase().trim(), event);
      });

      let addedEvents = [];

      for (const airtableEvent of filteredAirtableEvents) {
        // ✅ Validate event before proceeding
        if (!airtableEvent.start || !airtableEvent.end) {
          console.error(`❌ Skipping event "${airtableEvent.title}" due to missing start or end date.`);
          continue;
        }

        const eventTitle = airtableEvent.title.toLowerCase().trim();
        const matchingGoogleEvent = googleEventMap.get(eventTitle);

        if (matchingGoogleEvent) {
          if (isEventDifferent(airtableEvent, matchingGoogleEvent)) {
            console.log(`🔄 Updating event: ${airtableEvent.title}`);
            await updateGoogleCalendarEvent(
              matchingGoogleEvent.id,
              airtableEvent.title,
              airtableEvent.start,
              airtableEvent.end,
              calendarId,
              session
            );
          } else {
            console.log(`✅ No changes detected for event: ${airtableEvent.title}, skipping update.`);
          }
        } else {
          console.log(`🆕 Creating new event: ${airtableEvent.title}`);
          const googleEventId = await createGoogleCalendarEvent(airtableEvent, calendarId, session);
          if (googleEventId) {
            await updateAirtableWithGoogleEventIdAndProcessed(airtableEvent.id, googleEventId, true);
            console.log(`✅ New event created and linked: ${airtableEvent.title}`);

            // Add event details to the list
            addedEvents.push({
              title: airtableEvent.title,
              start: airtableEvent.start,
              end: airtableEvent.end
            });
          }
        }
      }

      // ✅ Store added events for this calendar
      updatedCalendarEvents[calendarName] = { added: addedEvents };

      console.log(`✅ Finished processing events for calendar: ${calendarName}`);
      await sleep(5000);

    } catch (error) {
      console.error(`❌ Error processing events for calendar "${calendarName}":`, error);
    }
  }

  // ✅ Remove duplicate events after processing all calendars
  for (const calendarId of Object.values(calendarMap)) {
    try {
      await removeDuplicateEvents(calendarId, session);
    } catch (error) {
      console.error(`❌ Error removing duplicate events for calendar ID "${calendarId}":`, error);
    }
  }

  // ✅ Update state with newly added events
  setCalendarEvents(prevEvents => ({
    ...prevEvents,
    ...updatedCalendarEvents
  }));
  
  if (allCalendarsProcessed) {
    console.log("✅ All events processed for all calendars. Terminating script.");
    terminateScript();
  } else {
    console.log("⚠️ Some events still need processing, keeping script active.");
  }
}






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
          {Object.entries(calendarEvents).map(([calendarName, events]) => {
            const added = events?.added || [];
            const updated = events?.updated || [];

            return (
              <div key={calendarName} className="calendar-section">
              <h2>{calendarName}</h2>
            
              {added.length > 0 && (
                <>
                  <h3>New Events</h3>
                  <ul>
                    {added.map((event, index) => {
                      // Ensure proper date conversion
                      const eventStart = event.start ? new Date(event.start).toLocaleString() : "Invalid Date";
                      const eventEnd = event.end ? new Date(event.end).toLocaleString() : "Invalid Date";
            
                      return (
                        <li key={index}>
                          <strong>{event.title}</strong> <br />
                          <span>Start: {isNaN(new Date(event.start)) ? "Invalid Date" : eventStart}</span> <br />
                          <span>End: {isNaN(new Date(event.end)) ? "Invalid Date" : eventEnd}</span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            
              {updated.length > 0 && (
                <>
                  <h3>Updated Events</h3>
                  <ul>
                    {updated.map((event, index) => {
                      const eventStart = event.start ? new Date(event.start).toLocaleString() : "Invalid Date";
                      const eventEnd = event.end ? new Date(event.end).toLocaleString() : "Invalid Date";
            
                      return (
                        <li key={index}>
                          <strong>{event.title}</strong> <br />
                          <span>Start: {isNaN(new Date(event.start)) ? "Invalid Date" : eventStart}</span> <br />
                          <span>End: {isNaN(new Date(event.end)) ? "Invalid Date" : eventEnd}</span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            
              {added.length === 0 && updated.length === 0 && <p>No new or updated events.</p>}
            </div>
            
            
            );
          })}
        </div>
      </>
    )}
  </div>
);
}

export default App;


