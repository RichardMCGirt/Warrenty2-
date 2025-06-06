
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

async function tryFetchServer(url, options = {}, timeout = 3000) {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (err) {
    console.warn(`⚠️ Skipping server call (${url}) - server might not be running.`);
    return null;
  }
}

async function refreshAccessToken() {
  try {
    console.log("🔄 Trying to refresh access token...");

    const response = await tryFetchServer("http://localhost:5001/api/refresh-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!response || !response.ok) {
      throw new Error("Server not available or token refresh failed");
    }

    const data = await response.json();

    if (data.access_token) {
      localStorage.setItem("accessToken", data.access_token);
      localStorage.setItem("tokenExpiry", (Date.now() + data.expires_in * 1000).toString());
      return data.access_token;
    }

    throw new Error("No access token returned");
  } catch (error) {
    console.warn("⚠️ Failed to refresh via server, fallback to existing token.");
    return localStorage.getItem("accessToken") || null;
  }
}

async function getValidAccessToken() {
  try {
    console.log("🔄 Checking if token refresh is needed...");

    const tokenExpiry = parseInt(localStorage.getItem("tokenExpiry"), 10) || 0;
    const accessToken = localStorage.getItem("accessToken");
    const now = Date.now();

    // 🔁 Handle case where token is missing but expiry is still valid
    if (!accessToken && tokenExpiry && now < tokenExpiry) {
      console.warn("⚠️ Token expiry exists but token is missing. Forcing token refresh.");
      return await refreshAccessToken();
    }

    // 🧼 Handle standard token expiration
    if (!tokenExpiry || now >= tokenExpiry) {
      console.warn("⚠️ Token expired or missing. Refreshing...");
      return await refreshAccessToken();
    }

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
  if (!event?.title || !event?.start || !event?.end) {
    console.error("❌ Missing required event fields:", event);
    return null;
  }

  const accessToken = session?.provider_token || await getValidAccessToken();
  if (!accessToken) {
    console.error("❌ No valid access token. Cannot create event.");
    return null;
  }

  const newEvent = {
    summary: event.title,
    description: event.description || "",
    start: {
      dateTime: new Date(event.start).toISOString(),
      timeZone: "America/Toronto",
    },
    end: {
      dateTime: new Date(event.end).toISOString(),
      timeZone: "America/Toronto",
    },
    location: event.location || "",
    attendees: event.fieldManagerEmail
      ? [{ email: event.fieldManagerEmail }]
      : [], // ✅ Add attendee if available
  };

  try {
    console.log("📤 Creating event:", JSON.stringify(newEvent, null, 2));

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(newEvent),
      }
    );

    const data = await response.json();
    if (!response.ok) {
      console.error("❌ Failed to create event:", data);
      return null;
    }

    console.log("✅ Event created:", data.id);
    return data.id;
  } catch (err) {
    console.error("❌ Network error creating event:", err);
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

async function fetchUnprocessedEventsFromAirtable() {
  if (isTerminated) {
    console.log('Script is terminated. Skipping fetch for unprocessed events.');
    return [];
  }

  console.log('Fetching unprocessed events from Airtable...');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString().split("T")[0]; // Extracts YYYY-MM-DD format
  
  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ?filterByFormula=AND(
    NOT({StartDate} = ''),
    NOT({EndDate} = ''),
    OR(
      IS_AFTER(DATETIME_FORMAT({StartDate}, 'YYYY-MM-DD'), '${todayISO}'),
      DATETIME_FORMAT({StartDate}, 'YYYY-MM-DD') = '${todayISO}'
    )
  )`;
  
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
            start: new Date(record.fields['StartDate']),
            end: new Date(record.fields['EndDate']),
            description: record.fields['Description of Issue'] || '',
            b: record.fields['b'] || '',
            processed: record.fields['Processed'] || false,
            location: [
              record.fields['Street Address'],
              record.fields['City'],
              record.fields['State'],
              record.fields['Zip Code']
            ].filter(Boolean).join(', '),
            fieldManagerEmail: record.fields['Field Manager Email'] || null, // ← ADD THIS
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

async function updateGoogleCalendarEvent(eventId, title, start, end, calendarId, accessToken, attendeeEmail = null) {
  console.log(`🔄 Updating event: ${title}`);

  if (!accessToken) {
    console.error("❌ No valid access token available.");
    return;
  }

  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`;

  try {
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

    const updatedEvent = {
      summary: title,
      start: {
        dateTime: new Date(start).toISOString(),
        timeZone: originalEvent.start?.timeZone || "America/New_York",
      },
      end: {
        dateTime: new Date(end).toISOString(),
        timeZone: originalEvent.end?.timeZone || "America/New_York",
      },
      attendees: attendeeEmail ? [{ email: attendeeEmail }] : [], // ✅ Include updated attendees
    };

    const updateResponse = await fetch(url, {
      method: 'PATCH',
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

    console.log(`✅ Event updated with attendees: ${title}`);
  } catch (error) {
    console.error('❌ Error updating event:', error);
  }
}

async function getAnyValidAccessToken(session) {
  let accessToken = session?.provider_token || localStorage.getItem("accessToken");

  if (!accessToken) {
    try {
      const tokenResponse = await fetch('http://localhost:5001/api/tokens');
      if (tokenResponse.ok) {
        const tokens = await tokenResponse.json();
        accessToken = tokens.access_token;
        console.log("✅ Token fetched from backend.");
      } else {
        console.warn("⚠️ Could not retrieve token from backend.");
      }
    } catch (error) {
      console.warn("⚠️ Backend unavailable for token fetch:", error.message);
    }
  }

  if (!accessToken) {
    console.error("❌ No access token available.");
  }

  return accessToken;
}

async function getGoogleCalendarEvent(eventId, calendarId, session) {
  const accessToken = await getAnyValidAccessToken(session);
  if (!accessToken) return null;

  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`;

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      console.error(`❌ Failed to fetch event from Google Calendar (${response.status})`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('❌ Error fetching Google Calendar event:', error);
    return null;
  }
}

async function deleteGoogleCalendarEvent(eventId, calendarId, session) {
  const accessToken = await getAnyValidAccessToken(session);
  if (!accessToken) return false;

  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`;

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 410) {
      console.warn(`Event ${eventId} already deleted (410 Gone). Skipping.`);
      return true;
    }

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
      Charlotte: 'c_424688691b4dace071516f7adb111ca9e74a5b290f11d33912bacfa933477bcc@group.calendar.google.com',
  };

  useEffect(() => {
    const hash = window.location.hash;
    if (hash && hash.includes("access_token")) {
      const params = new URLSearchParams(hash.substring(1));
      const token = params.get("access_token");
  
      if (token) {
        localStorage.setItem("accessToken", token);
        fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })
          .then((res) => res.json())
          .then((userInfo) => {
            const email = userInfo.email;
            if (email.endsWith("@vanirinstalledsales.com")) {
              console.log("✅ Logged in:", email);
              localStorage.setItem("userEmail", email);
              // Proceed with rest of your app logic
            } else {
              alert("❌ Unauthorized. You must use a @vanirinstalledsales.com account.");
              localStorage.removeItem("accessToken");
            }
          });
      }
    }
  }, []);
  

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
    nextTenMinuteMark.setMinutes(Math.ceil(now.getMinutes() / 5) * 5, 0, 0);

    // If we're already at the next 10-minute mark, move to the next one
    if (nextTenMinuteMark <= now) {
        nextTenMinuteMark.setMinutes(nextTenMinuteMark.getMinutes() + 5);
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

// ✅ THIS IS WHERE YOU ADD IT
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const authCode = params.get("code");

  if (authCode) {
    fetch("http://localhost:5001/api/exchange-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: authCode }),
    })
    .then(res => res.json())
    .then(data => {
      console.log("🔐 Tokens from backend:", data);
      localStorage.setItem("accessToken", data.access_token);
      localStorage.setItem("refreshToken", data.refresh_token);
      localStorage.setItem("tokenExpiry", (Date.now() + data.expires_in * 1000).toString());

      // Optionally clean up the URL so ?code= disappears after it's handled
      window.history.replaceState({}, document.title, window.location.pathname);
    });
  }
}, []);

function isEventDifferent(airtableEvent, googleEvent) {
  const normalize = (str) => String(str || "").trim().toLowerCase();

  const airtableTitle = normalize(airtableEvent.title);
  const googleTitle = normalize(googleEvent.summary);

  const airtableLocation = normalize(airtableEvent.location);
  const googleLocation = normalize(googleEvent.location);

  const airtableDescription = normalize(airtableEvent.description);
  const googleDescription = normalize(googleEvent.description);

  const airtableStart = new Date(airtableEvent.start).toISOString();
  const googleStart = googleEvent.start?.dateTime || googleEvent.start?.date;

  const airtableEnd = new Date(airtableEvent.end).toISOString();
  const googleEnd = googleEvent.end?.dateTime || googleEvent.end?.date;

  const differences = [];

  if (airtableTitle !== googleTitle) {
    differences.push("Title");
  }
  if (airtableLocation !== googleLocation) {
    differences.push("Location");
  }
  if (airtableDescription !== googleDescription) {
    differences.push("Description");
  }
  if (airtableStart !== googleStart) {
    differences.push("Start Time");
  }
  if (airtableEnd !== googleEnd) {
    differences.push("End Time");
  }

  // ✅ Check if Field Manager Email is present and included in Google attendees
  const airtableAttendee = normalize(airtableEvent.fieldManagerEmail || "");
  const googleAttendees = (googleEvent.attendees || []).map(a => normalize(a.email));
  const attendeeMissing = airtableAttendee && !googleAttendees.includes(airtableAttendee);

  if (attendeeMissing) {
    differences.push("Attendee Missing");
  }

  console.log("🔍 Comparing Airtable vs Google Event:");
  console.table({
    Title: { Airtable: airtableTitle, Google: googleTitle },
    Location: { Airtable: airtableLocation, Google: googleLocation },
    Description: { Airtable: airtableDescription, Google: googleDescription },
    Start: { Airtable: airtableStart, Google: googleStart },
    End: { Airtable: airtableEnd, Google: googleEnd },
    Attendee: {
      Airtable: airtableAttendee || "(none)",
      Google: googleAttendees.join(", ") || "(none)"
    }
  });

  if (differences.length > 0) {
    console.log(`⚠️ Differences detected in: ${differences.join(", ")}`);
    return true;
  }

  console.log("✅ No differences found. Event is up to date.");
  return false;
}

  async function fetchGoogleCalendarEvents(calendarId, session) {
    const accessToken = await getAnyValidAccessToken(session);
    if (!accessToken) return [];
  
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
  
    const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?timeMin=${startOfToday.toISOString()}&maxResults=250&orderBy=startTime&singleEvents=true`;
  
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });
  
      if (!response.ok) {
        const errorData = await response.json();
        console.error('❌ Failed to fetch events from Google Calendar:', errorData);
        return [];
      }
  
      const data = await response.json();
      console.log(`✅ Fetched ${data.items?.length || 0} events from Google Calendar.`);
      return data.items || [];
    } catch (error) {
      console.error('❌ Error fetching Google Calendar events:', error.message);
      return [];
    }
  }
  
  async function getAnyValidAccessToken(session) {
    let accessToken = session?.provider_token || localStorage.getItem("accessToken");
  
    // Try to fallback to backend if not available
    if (!accessToken) {
      try {
        const tokenResponse = await fetch('http://localhost:5001/api/tokens');
        if (tokenResponse.ok) {
          const tokens = await tokenResponse.json();
          accessToken = tokens.access_token;
          console.log("✅ Token fetched from backend.");
        } else {
          console.warn("⚠️ Could not retrieve token from backend.");
        }
      } catch (error) {
        console.warn("⚠️ Backend unavailable for token fetch:", error.message);
      }
    }
  
    if (!accessToken) {
      console.error("❌ No access token available.");
    }
  
    return accessToken;
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
        return null;
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
        nextSyncTime.setMinutes(Math.ceil(now.getMinutes() / 5) * 5, 0, 0);

        // If we're already at the next 10-minute mark, move to the next one
        if (nextSyncTime <= now) {
            nextSyncTime.setMinutes(nextSyncTime.getMinutes() + 5);
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
    const response = await tryFetchServer("http://localhost:5001/api/refresh-token", {
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

function LoginButton() {
  const login = () => {
    const CLIENT_ID = '882687108659-vqkr605rdsgesl5h348l07o0um11rjjg.apps.googleusercontent.com';
    const REDIRECT_URI =
      window.location.hostname === "localhost"
        ? "http://localhost:3000/oauth2callback"
        : "https://warrentycalender.vanirinstalledsales.info/oauth2callback";
  
    const BACKEND_BASE_URL =
      window.location.hostname === "localhost"
        ? "http://localhost:5001"
        : "https://api.warrentycalender.vanirinstalledsales.info";
  
    const SCOPE = "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email";
    const RESPONSE_TYPE = "code";
  
    const googleLoginUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=${RESPONSE_TYPE}&scope=${encodeURIComponent(SCOPE)}&access_type=offline&prompt=consent`;
  
    window.location.href = googleLoginUrl;
  };
  

  return <button onClick={login}>Sign in with Google</button>;
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
                    const normalizedTitle = (event.summary || '').toLowerCase().trim().replace(/\s+/g, ' ');
                    const normalizedStart = event.start?.dateTime
                        ? new Date(event.start.dateTime).toISOString()
                        : event.start?.date
                            ? new Date(event.start.date).toISOString()
                            : '';
                
                    const key = `${normalizedTitle}_${normalizedStart}`;
                    googleEventMap.set(key, event);
                });
                

                let addedEvents = [];

                for (const airtableEvent of filteredAirtableEvents) {
                    if (!airtableEvent.start || !airtableEvent.end) {
                        console.error(`❌ Skipping event "${airtableEvent.title}" due to missing start or end date.`);
                        continue;
                    }

                    const normalizedAirtableTitle = (airtableEvent.title || '').toLowerCase().trim().replace(/\s+/g, ' ');
                    const normalizedAirtableStart = airtableEvent.start
                        ? new Date(airtableEvent.start).toISOString()
                        : '';
                    const eventKey = `${normalizedAirtableTitle}_${normalizedAirtableStart}`;
                    const matchingGoogleEvent = googleEventMap.get(eventKey);
                    

                    if (matchingGoogleEvent) {
                        if (isEventDifferent(airtableEvent, matchingGoogleEvent)) {
                            console.log(`🔄 Updating event: ${airtableEvent.title}`);
                            await updateGoogleCalendarEvent(
                              matchingGoogleEvent.id,
                              airtableEvent.title,
                              airtableEvent.start,
                              airtableEvent.end,
                              calendarId,
                              accessToken,
                              airtableEvent.fieldManagerEmail // ✅ pass this in
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
  <div className="App" style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
    <h1>Google Calendar Sync</h1>

    {/* 🔐 Google Sign In */}
    <LoginButton />


    <p>Next sync in: {formatCountdown(countdown)}</p>

    <button onClick={fetchAndProcessEvents} style={{ margin: '10px 0' }}>
      Sync Now
    </button>

    {/* Calendar Display */}
    <div
      className="calendar-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '20px',
        marginTop: '20px',
      }}
    >
      {Object.entries(calendarEvents).map(([calendarName, events]) => {
        const added = events?.added || [];
        const updated = events?.updated || [];

        return (
          <div
            key={calendarName}
            className="calendar-section"
            style={{ border: '1px solid #ccc', borderRadius: '8px', padding: '15px' }}
          >
            <h2>{calendarName}</h2>

            {added.length > 0 && (
              <>
                <h3>New Events</h3>
                <ul>
                  {added.map((event, index) => {
                    const eventStart = event.start ? new Date(event.start).toLocaleString() : "Invalid Date";
                    const eventEnd = event.end ? new Date(event.end).toLocaleString() : "Invalid Date";

                    return (
                      <li key={index}>
                        <strong>{event.title}</strong><br />
                        <span>Start: {eventStart}</span><br />
                        <span>End: {eventEnd}</span>
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
                        <strong>{event.title}</strong><br />
                        <span>Start: {eventStart}</span><br />
                        <span>End: {eventEnd}</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            {added.length === 0 && updated.length === 0 && (
              <p>No new or updated events.</p>
            )}
          </div>
        );
      })}
    </div>
  </div>
);
}

export default App;
