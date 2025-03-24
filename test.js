
import React, { useState, useEffect } from 'react';
import './App.css';

import { useSession, useSupabaseClient} from '@supabase/auth-helpers-react';
let isTerminated = false; // Initialize the variable early in the file

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


async function fetchGoogleCalendarEvents(calendarId) {
  console.log(`📅 Fetching events for Google Calendar: ${calendarId}`);

  try {
      let accessToken = await getValidAccessToken();
      if (!accessToken) {
          console.error("❌ No valid access token available. Attempting to refresh...");
          accessToken = await refreshAccessToken();
      }

      if (!accessToken) {
          console.error("❌ Still no valid access token after refresh. Aborting.");
          return;
      }

      console.log("🔑 Using Access Token:", accessToken);

      const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?timeMin=${new Date().toISOString()}&maxResults=250&orderBy=startTime&singleEvents=true`;

      console.log(`🌍 Calling Google Calendar API: ${url}`);

      const response = await fetch(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
          const errorData = await response.json();
          console.error('❌ Failed to fetch Google Calendar events:', errorData);
          return [];
      }

      const data = await response.json();
      console.log(`✅ Successfully fetched ${data.items?.length || 0} events.`);
      return data.items || [];

  } catch (error) {
      console.error('❌ Error fetching Google Calendar events:', error);
      return [];
  }
}

async function refreshAccessToken() {
  try {
      console.log("🔄 Refreshing access token...");

      const response = await fetch("http://localhost:5001/api/refresh-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const data = await response.json();
      if (data.access_token) {
          console.log("✅ New Access Token:", data.access_token);

          // Store new token & expiry time
          localStorage.setItem("accessToken", data.access_token);
          localStorage.setItem("tokenExpiry", (Date.now() + data.expires_in * 1000).toString());

          return data.access_token;
      } else {
          throw new Error("No access token returned");
      }
  } catch (error) {
      console.error("❌ Failed to refresh token:", error);
      return null;
  }
}


async function getValidAccessToken() {
  try {
      console.log("🔄 Checking if token refresh is needed...");
      
      let tokenExpiry = parseInt(localStorage.getItem("tokenExpiry"), 10) || 0;
      let now = Date.now();

      if (!tokenExpiry || now >= tokenExpiry) {
          console.warn("⚠️ Token expired or missing. Refreshing...");
          return await refreshAccessToken();  // Refresh token if expired
      }

      let accessToken = localStorage.getItem("accessToken");
      console.log("✅ Using stored access token:", accessToken);
      return accessToken;
  } catch (error) {
      console.error("❌ Error getting valid access token:", error);
      return null;
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


async function createGoogleCalendarEvent(event, calendarId, session) {
  if (!session || !session.provider_token) {
    console.error("❌ No valid session token found. Attempting to refresh...");
    session = { provider_token: await getValidAccessToken() };
  }

  if (!session.provider_token) {
    console.error("❌ Still no valid access token after refresh. Aborting event creation.");
    return null;
  }

  console.log("🔑 Using Access Token in Script:", session.provider_token);

  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;
  
  const newEvent = {
    summary: event.title,
    description: event.description || "No description provided",
    start: { dateTime: new Date(event.start).toISOString(), timeZone: "America/Toronto" },
    end: { dateTime: new Date(event.end).toISOString(), timeZone: "America/Toronto" },
    location: event.location || "No location provided",
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.provider_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(newEvent),
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error("❌ Error creating Google Calendar event:", data);
      return null;
    }

    console.log(`✅ Event created successfully: "${event.title}" (ID: ${data.id})`);
    return data.id;
  } catch (error) {
    console.error("❌ Failed to create event:", error);
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
            b: record.fields['b'] || '',
            processed: record.fields['Processed'] || false,
            streetAddress: record.fields['Street Address'] || "",
            city: record.fields['City'] || "",
            state: record.fields['State'] || "",
            zipCode: record.fields['Zip Code'] || "",
            location: [
                record.fields['Street Address'],
                record.fields['City'],
                record.fields['State'],
                record.fields['Zip Code']
            ].filter(Boolean).join(', ')
        }));
        
        console.log("🚀 Processed Airtable records:", records);
        
        console.log("Fetched raw Airtable data:", data.records);


      console.log("Fetched unprocessed records:", records);
      
      if (records.length === 0) {
        console.log('No unprocessed events found.');
        // Do NOT set isTerminated to true, or reset it after a delay
        setTimeout(() => { isTerminated = false; }, 60000); // Reset after 1 minute
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
  console.log(`🔍 Checking for duplicate event: "${event.title}"`);

  if (!session || !session.provider_token) {
      console.warn("⚠️ No valid session token found. Fetching a new token...");
      session = { provider_token: await getValidAccessToken() };
      if (!session.provider_token) {
          console.error("❌ Failed to retrieve a valid access token. Skipping duplicate check.");
          return null;
      }
  }

  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;
  const timeMin = event.start ? new Date(event.start).toISOString() : null;
  const timeMax = event.end ? new Date(event.end).toISOString() : null;

  if (!timeMin || !timeMax) {
      console.error(`❌ Invalid start or end date for event "${event.title}":`, { timeMin, timeMax });
      return null;
  }

  try {
      console.log(`🌍 Fetching events from Google Calendar between ${timeMin} and ${timeMax}...`);

      const response = await fetch(
          `${url}?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true`,
          {
              headers: {
                  Authorization: `Bearer ${session.provider_token}`,
              },
          }
      );

      if (!response.ok) {
          const errorData = await response.json();
          console.error("❌ Failed to fetch events from Google Calendar:", errorData);
          return null;
      }

      const data = await response.json();
      console.log(`📌 Retrieved ${data.items?.length || 0} events for duplicate check.`);

      if (!data.items || data.items.length === 0) {
          console.log(`✅ No duplicate event found for "${event.title}".`);
          return null;
      }

      // Normalize event data for better duplicate detection
      const normalizeText = (text) => text.trim().replace(/\s+/g, " ").toLowerCase();
      const duplicateEvent = data.items.find((existingEvent) => {
          if (!existingEvent.start?.dateTime || !existingEvent.end?.dateTime) {
              console.warn(`⚠️ Skipping event due to missing start or end time:`, existingEvent);
              return false;
          }

          const googleStart = normalizeDateTime(existingEvent.start.dateTime);
          const googleEnd = normalizeDateTime(existingEvent.end.dateTime);

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
      console.error("❌ Error checking for duplicate events:", error);
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
) {
  console.log(`Starting to populate Google Calendar "${calendarName}" with Airtable records...`);

  if (isTerminated) {
    console.log('🛑 Script is terminated. Skipping population.');
    return;
  }

  const airtableEvents = await fetchUnprocessedEventsFromAirtable();
  if (isTerminated) {
    console.log("🛑 Script was terminated after fetching. Stopping processing.");
    return;
  }

  const totalFetchedRecords = airtableEvents.length;
  if (totalFetchedRecords === 0) {
    console.log(`✅ No unprocessed events to sync for calendar "${calendarName}".`);
    return;
  }

  let createdEventsCount = 0;
  const added = [];
  const failed = [];
  const noChange = [];
  const processedRecordIds = new Set();

  for (const event of airtableEvents) {
    if (isTerminated) {
      console.log("🛑 Script was terminated. Stopping event processing.");
      return;
    }

    if (event.googleEventId || event.processed) {
      console.log(`Skipping event "${event.title}" - GoogleEventId or Processed status already set.`);
      noChange.push(event.title);
      processedRecordIds.add(event.id);
      continue;
    }

    try {
      await lockAirtableRecord(event.id);
      let googleEventId = await checkForDuplicateEvent(event, calendarId, session);

      if (isTerminated) {
        console.log("🛑 Termination detected. Skipping event creation.");
        return;
      }

      if (googleEventId) {
        const googleEvent = await getGoogleCalendarEvent(googleEventId, calendarId, session);

        // Skip updates if no changes exist
        if (!isEventDifferent(event, googleEvent)) {
          console.log(`✅ No changes detected for event "${event.title}". Skipping update.`);
          noChange.push(event.title);
          processedRecordIds.add(event.id);
          await unlockAirtableRecord(event.id);
          continue;
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
        console.log(`🆕 Creating new event: ${event.title}`);
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
      console.error(`❌ Error processing event "${event.title}":`, error);
      failed.push(event.title);
    }

    await unlockAirtableRecord(event.id);
    await sleep(12000); // Delay to avoid hitting rate limits
  }

  if (isTerminated) {
    console.log("🛑 All records processed but script was terminated.");
    return;
  }

  setAddedRecords((prev) => [...prev, ...added]);
  setFailedRecords((prev) => [...prev, ...failed]);
  setNoChangeRecords(noChange);

  console.log(`✅ Total number of events created: ${createdEventsCount}`);
  console.log(`✅ Total number of records processed for calendar "${calendarName}": ${processedRecordIds.size}`);
}

function isEventDifferent(airtableEvent, googleEvent) {
  if (!airtableEvent || !googleEvent || !googleEvent.start || !googleEvent.end) {
      console.error('❌ Missing event data:', { airtableEvent, googleEvent });
      return true; 
  }

  const normalizeText = (text) => (text || "").trim().toLowerCase();
  
  return (
      normalizeText(airtableEvent.title) !== normalizeText(googleEvent.summary) ||
      normalizeText(airtableEvent.location) !== normalizeText(googleEvent.location) ||
      new Date(airtableEvent.start).toISOString() !== googleEvent.start.dateTime ||
      new Date(airtableEvent.end).toISOString() !== googleEvent.end.dateTime
  );

}



async function updateGoogleCalendarEvent(eventId, title, start, end, calendarId) {
  console.log(`🔄 Updating event: ${title}`);

  // ✅ Get a fresh valid access token
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
      console.error("❌ No valid access token available. Skipping update.");
      return;
  }

  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`;

  try {
      // Fetch the original event details before updating
      const originalResponse = await fetch(url, {
          method: 'GET',
          headers: {
              Authorization: `Bearer ${accessToken}`,
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
      const originalTimeZone = originalEvent.start?.timeZone || "America/New_York";

      // Convert to strict ISO format
      const normalizeToISO = (dateStr) => (dateStr ? new Date(dateStr).toISOString() : null);
      const normalizedOriginalStart = normalizeToISO(originalStart);
      const normalizedOriginalEnd = normalizeToISO(originalEnd);
      const normalizedNewStart = normalizeToISO(start);
      const normalizedNewEnd = normalizeToISO(end);

      console.log("🔵 Original Event Data:", {
          title: originalEvent.summary,
          start: normalizedOriginalStart,
          end: normalizedOriginalEnd,
          timeZone: originalTimeZone,
      });

      console.log("🟡 Updated Event Data:", {
          summary: title,
          start: normalizedNewStart,
          end: normalizedNewEnd,
          timeZone: originalTimeZone,
      });

      // ✅ Skip update if nothing has changed
      if (normalizedNewStart === normalizedOriginalStart && normalizedNewEnd === normalizedOriginalEnd) {
          console.log("✅ No change detected. Skipping update.");
          return;
      }

      console.log("⚠️ Changes detected. Updating event...");

      // Construct updated event object
      const updatedEvent = {
          summary: title,
          start: { dateTime: normalizedNewStart, timeZone: originalTimeZone },
          end: { dateTime: normalizedNewEnd, timeZone: originalTimeZone },
      };

      const updateResponse = await fetch(url, {
          method: 'PUT',
          headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
          },
          body: JSON.stringify(updatedEvent),
      });

      if (!updateResponse.ok) {
          console.error("❌ Failed to update event:", await updateResponse.json());
          return;
      }

      console.log(`✅ Event updated successfully: ${title}`);
  } catch (error) {
      console.error('❌ Error updating event:', error);
  }
}



async function getGoogleCalendarEvent(eventId, calendarId, session) {
  // Fetch the token from the backend
  const tokenResponse = await fetch('http://localhost:5001/api/tokens');
  
  if (!tokenResponse.ok) {
    console.error("Failed to fetch token");
    return null;
  }

  const tokens = await tokenResponse.json();
  const accessToken = tokens.access_token;

  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`;
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
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
  // Fetch the token from the backend
  const tokenResponse = await fetch('http://localhost:5001/api/tokens');
  
  if (!tokenResponse.ok) {
    console.error("Failed to fetch token");
    return false;
  }

  const tokens = await tokenResponse.json();
  const accessToken = tokens.access_token;

  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`;

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,  // Use the fetched access token
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
  if (isTerminated) {
    console.log("🛑 Script is terminated. Skipping duplicate removal.");
    return;
  }

  console.log(`Checking for duplicate events in calendar: ${calendarId}...`);

  try {
    const events = await fetchGoogleCalendarEvents(calendarId, session);
    if (isTerminated) {
      console.log("🛑 Script was terminated after fetching events. Stopping processing.");
      return;
    }

    if (!events || events.length === 0) {
      console.log("No events found in calendar.");
      return;
    }

    const eventMap = new Map();
    const duplicateEvents = [];

    events.forEach(event => {
      if (isTerminated) {
        console.log("🛑 Termination detected during duplicate search.");
        return;
      }
      const eventKey = `${event.summary.toLowerCase().trim()}_${new Date(event.start.dateTime || event.start.date).toISOString()}`;

      if (eventMap.has(eventKey)) {
        duplicateEvents.push(event);
      } else {
        eventMap.set(eventKey, event);
      }
    });

    for (const event of duplicateEvents) {
      if (isTerminated) {
        console.log("🛑 Termination detected. Stopping deletion process.");
        return;
      }
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
       Charlotte: 'warranty.charlotte@vanirinstalledsales.com',
  };

  // ✅ Automatically refresh token every 55 minutes
useEffect(() => {
  const checkTokenExpiry = async () => {
      let tokenExpiry = parseInt(localStorage.getItem("tokenExpiry"), 10) || 0;
      let now = Date.now();

      if (!tokenExpiry || now >= tokenExpiry) {
          console.warn("⚠️ Token expired or missing. Refreshing...");
          await getValidAccessToken();
      } else {
          console.log("✅ Token is still valid.");
      }
  };

  checkTokenExpiry();
  
  // Refresh token every 55 minutes (3300 seconds)
  const interval = setInterval(checkTokenExpiry, 55 * 60 * 1000);

  return () => clearInterval(interval);
}, []);


  function getTimeUntilNextQuarterHour() {
    const now = new Date();
    const nextTenMinuteMark = new Date(now);
    
    // Calculate the next 10-minute interval from the beginning of the hour
    nextTenMinuteMark.setMinutes(Math.ceil(now.getMinutes() / 10) * 10, 0, 0);

    // If we're already at the next 10-minute mark, move to the next one
    if (nextTenMinuteMark <= now) {
        nextTenMinuteMark.setMinutes(nextTenMinuteMark.getMinutes() + 10);
    }

    return Math.max(0, Math.floor((nextTenMinuteMark - now) / 1000)); // Return remaining time in seconds
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
  
  
  async function fetchGoogleCalendarEvents(calendarId) {
    let accessToken = await getValidAccessToken(); // Get a valid token from storage or refresh

    if (!accessToken) {
        console.error("❌ No valid access token available. Aborting fetch.");
        return [];
    }

    console.log("📅 Fetching Google Calendar events with token:", accessToken);

    try {
        const response = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?timeMin=${new Date().toISOString()}&maxResults=250&orderBy=startTime&singleEvents=true`,
            {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                },
            }
        );

        if (!response.ok) {
            const errorResponse = await response.json();

            if (errorResponse.error.code === 401) {
                console.warn("🔄 Access token expired. Attempting to refresh...");

                // Refresh the token and retry once
                const newAccessToken = await refreshAccessToken();
                if (newAccessToken) {
                    console.log("🔄 Retrying event fetch with new token...");
                    return await fetchGoogleCalendarEvents(calendarId); // Recursive retry
                } else {
                    console.error("❌ Failed to refresh token. User may need to re-authenticate.");
                    return [];
                }
            }

            console.error("❌ Google Calendar API Error:", errorResponse);
            throw new Error(errorResponse.error.message);
        }

        const data = await response.json();
        console.log(`✅ Successfully fetched ${data.items.length} events.`);
        return data.items || []; // Ensure an empty array is returned if no events exist
    } catch (error) {
        console.error("❌ Failed to fetch Google Calendar events:", error.message);
        return [];
    }
}



  
  

  
  
  
  
  async function updateGoogleCalendarEvent(eventId, title, start, end, calendarId) {
    try {
        const accessToken = await getValidAccessToken();
        if (!accessToken) {
            console.error("❌ No valid access token available.");
            return;
        }

        const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`;

        // 🟢 Fetch the original event before updating
        const originalResponse = await fetch(url, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        });

        if (!originalResponse.ok) {
            console.error("❌ Failed to fetch original Google Calendar event.");
            return;
        }

        const originalEvent = await originalResponse.json();
        const originalStart = originalEvent.start?.dateTime || originalEvent.start?.date;
        const originalEnd = originalEvent.end?.dateTime || originalEvent.end?.date;
        const originalTimeZone = originalEvent.start?.timeZone || "America/New_York"; // Default to EST

        // ✅ Normalize all times to strict ISO format
        const normalizeToISO = (dateStr) => dateStr ? new Date(dateStr).toISOString() : null;
        const normalizedOriginalStart = normalizeToISO(originalStart);
        const normalizedOriginalEnd = normalizeToISO(originalEnd);
        const normalizedNewStart = normalizeToISO(start);
        const normalizedNewEnd = normalizeToISO(end);

        console.log("🔵 Original Event (Before Update):", {
            summary: originalEvent.summary,
            start: normalizedOriginalStart,
            end: normalizedOriginalEnd,
            timeZone: originalTimeZone,
        });

        console.log("🟡 Updated Event Data (Before Sending):", {
            summary: title,
            start: normalizedNewStart,
            end: normalizedNewEnd,
            timeZone: originalTimeZone,
        });

        // 🛑 Prevent unnecessary updates if times are unchanged
        if (normalizedNewStart === normalizedOriginalStart && normalizedNewEnd === normalizedOriginalEnd) {
            console.log("✅ No changes detected. Skipping update.");
            return;
        }

        console.log("⚠️ Change detected. Updating event...");

        // 🔄 Prepare the updated event payload
        const updatedEvent = {
            summary: title,
            start: { dateTime: normalizedNewStart, timeZone: originalTimeZone },
            end: { dateTime: normalizedNewEnd, timeZone: originalTimeZone },
        };

        const options = {
            method: 'PATCH',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(updatedEvent),
        };

        // ✅ Handle API rate limits by retrying on failure
        const apiResponse = await fetchWithRetry(url, options);
        if (!apiResponse) {
            console.error("❌ Failed to update Google Calendar event after retries.");
            return;
        }

        console.log(`✅ Successfully updated event: ${title}`);
    } catch (error) {
        console.error("❌ Error updating Google Calendar event:", error);
    }
}
async function fetchWithRetry(url, options, retries = 3, delay = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
      try {
          const response = await fetch(url, options);
          if (response.ok) return response;

          console.warn(`⚠️ API call failed (Attempt ${attempt}/${retries}): ${response.statusText}`);
          if (response.status === 429) {
              console.log("⏳ Rate limit hit. Retrying after delay...");
              await new Promise(resolve => setTimeout(resolve, delay));
          } else {
              return null; // Stop retrying on other errors
          }
      } catch (error) {
          console.error("❌ API request error:", error);
      }
  }
  return null;
}


useEffect(() => {
    const getTimeUntilNextQuarterHour = () => {
        const now = new Date();
        const nextSyncTime = new Date(now);

        // Calculate the next 10-minute interval from the beginning of the hour
        nextSyncTime.setMinutes(Math.ceil(now.getMinutes() / 10) * 10, 0, 0);

        // If we're already at the next 10-minute mark, move to the next one
        if (nextSyncTime <= now) {
            nextSyncTime.setMinutes(nextSyncTime.getMinutes() + 10);
        }

        return Math.max(0, Math.floor((nextSyncTime - now) / 1000)); // Return remaining time in seconds
    };

    const interval = setInterval(async () => {
        const currentHour = new Date().getHours();
        
        if (currentHour >= 7 && currentHour <= 17) {
            const timeUntilNextSync = getTimeUntilNextQuarterHour();
            setCountdown(timeUntilNextSync);

            if (timeUntilNextSync === 0) {
                console.log("⏳ Checking if token needs refresh...");
                
                let accessToken = await getValidAccessToken();
                if (!accessToken) {
                    console.error("❌ No valid token available. Skipping sync.");
                    return;
                }

                console.log("🔄 Running event sync...");
                await fetchAndProcessEvents();

                setCountdown(getTimeUntilNextQuarterHour()); // Reset countdown after sync
            }
        }
    }, 1000); // Check every second to determine when to sync

    return () => clearInterval(interval);
}, [session]); // Depend on session to ensure proper reactivity

  

async function handleLogin() {
  try {
      const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
              scopes: 'https://www.googleapis.com/auth/calendar',
              redirectTo: window.location.origin, // Redirect back to app after login
          },
      });

      if (error) throw error;

      console.log('✅ Supabase Session:', data.session);

      if (data.session) {
          handleAuthSuccess(data.session);  // ✅ Now using the function to handle token storage
      }
  } catch (error) {
      console.error('❌ Error during login:', error);
  }
}


async function saveTokensToBackend(tokens) {
  try {
      const response = await fetch("http://localhost:5001/save-tokens", {
          method: "POST",
          headers: {
              "Content-Type": "application/json",
          },
          body: JSON.stringify(tokens),
      });

      if (!response.ok) {
          throw new Error("Failed to save tokens");
      }

      console.log("✅ Tokens successfully sent to the backend.");
  } catch (error) {
      console.error("❌ Error saving tokens:", error);
  }
}

async function handleAuthSuccess(session) {
  console.log("🔑 Tokens received:", session);

  if (!session?.provider_token) {
      console.error("❌ No access token found.");
      return;
  }

  const tokens = {
      access_token: session.provider_token,
      refresh_token: session.refresh_token,  // Ensure this exists, or persist it from backend
      expires_in: session.expires_in || 3600,
      token_type: "Bearer",
  };

  // ✅ Send tokens to backend for storage
  await saveTokensToBackend(tokens);
}



  
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
    try {
        console.log("🚀 Fetching and processing events for all calendars...");

        // ✅ Retrieve a valid access token ONCE to avoid redundant refreshes
        let accessToken = await getValidAccessToken();
        if (!accessToken) {
            console.error("❌ No valid access token available. Aborting.");
            return;
        }

        let allCalendarsProcessed = true;
        let updatedCalendarEvents = {};

        for (const [calendarName, calendarId] of Object.entries(calendarMap)) {
            console.log(`📅 Processing events for calendar: ${calendarName}`);

            try {
                // ✅ Fetch and filter Airtable events for this specific calendar
                const airtableEvents = await fetchUnprocessedEventsFromAirtable();
                const filteredAirtableEvents = airtableEvents.filter(
                    (event) => event.b?.toLowerCase().trim().replace(/\s+/g, "") === calendarName.toLowerCase().trim()
                );

                if (filteredAirtableEvents.length === 0) {
                    console.log(`✅ No unprocessed events found for ${calendarName}. Skipping.`);
                    continue;
                }

                console.log(`📊 Filtered ${filteredAirtableEvents.length} events from Airtable for calendar: ${calendarName}`);
                
                // ✅ Fetch events from Google Calendar (only once per calendar)
                const googleCalendarEvents = await fetchGoogleCalendarEvents(calendarId);
                console.log(`📊 Fetched ${googleCalendarEvents.length} events from Google Calendar: ${calendarName}`);

                const googleEventMap = new Map();
                googleCalendarEvents.forEach((event) => {
                    googleEventMap.set(event.summary?.toLowerCase().trim(), event);
                });

                let addedEvents = [];

                for (const airtableEvent of filteredAirtableEvents) {
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
                                accessToken
                            );
                        } else {
                            console.log(`✅ No changes detected for event: ${airtableEvent.title}, skipping update.`);
                        }
                    } else {
                        console.log(`🆕 Creating new event: ${airtableEvent.title}`);
                        const googleEventId = await createGoogleCalendarEvent(airtableEvent, calendarId, accessToken);
                        if (googleEventId) {
                            await updateAirtableWithGoogleEventIdAndProcessed(airtableEvent.id, googleEventId, true);
                            console.log(`✅ New event created and linked: ${airtableEvent.title}`);
                            addedEvents.push({
                                title: airtableEvent.title,
                                start: airtableEvent.start,
                                end: airtableEvent.end
                            });
                        }
                    }
                }

                updatedCalendarEvents[calendarName] = { added: addedEvents };

                console.log(`✅ Finished processing events for calendar: ${calendarName}`);
                await sleep(5000);
            } catch (calendarError) {
                console.error(`❌ Error processing events for calendar "${calendarName}":`, calendarError);
            }
        }

        // ✅ Remove duplicate events AFTER processing all calendars
        for (const calendarId of Object.values(calendarMap)) {
            try {
                await removeDuplicateEvents(calendarId, accessToken);
            } catch (error) {
                console.error(`❌ Error removing duplicate events for calendar ID "${calendarId}":`, error);
            }
        }

        // ✅ Update state after processing all calendars
        setCalendarEvents((prevEvents) => ({
            ...prevEvents,
            ...updatedCalendarEvents
        }));

        console.log("✅ All events processed for all calendars.");
    } catch (error) {
        console.error("❌ Fatal error in fetchAndProcessEvents():", error);
    }
}








return (
  <div className="App">
    <h1>Google Calendar Sync</h1>
    
    <p>Next sync in: {formatCountdown(countdown)}</p>
    {!session ? (
                <button onClick={getValidAccessToken}>Sign in with Google</button>
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