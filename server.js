require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs');
const fetch = require('node-fetch'); 
const express = require("express");
const axios = require("axios");
const dotenv = require("dotenv");
const cors = require("cors");

dotenv.config();

// ✅ Load Google OAuth credentials from environment variables
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const refreshToken = process.env.REFRESH_TOKEN;
const PORT = process.env.PORT || 5001;

const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:5001/oauth2callback';
const app = express();
app.use(express.json());
app.use(cors());

const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
let tokens = {
    access_token: process.env.ACCESS_TOKEN,
    refresh_token: process.env.REFRESH_TOKEN,
    expiry_date: Date.now() + 3600 * 1000, // Set an expiry time
  };

app.get('/', (req, res) => {
    res.send('✅ Server is running and ready!');
});

app.get("/refresh-token", async (req, res) => {
    try {
      console.log("🔄 Refreshing Google Access Token...");
  
      if (!tokens.refresh_token) {
        return res.status(400).json({ error: "No refresh token available" });
      }
  
      const response = await axios.post("https://oauth2.googleapis.com/token", null, {
        params: {
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          refresh_token: tokens.refresh_token,
          grant_type: "refresh_token",
        },
      });
  
      const newTokens = response.data;
      newTokens.expiry_date = Date.now() + newTokens.expires_in * 1000; // Convert expiry time
  
      tokens.access_token = newTokens.access_token;
      tokens.expiry_date = newTokens.expiry_date;
  
      console.log("✅ New Access Token:", newTokens.access_token);
      
      res.json({ accessToken: newTokens.access_token, expiresIn: newTokens.expires_in });
    } catch (error) {
      console.error("❌ Failed to refresh access token:", error.response?.data || error.message);
      res.status(500).json({ error: "Failed to refresh access token" });
    }
  });
  
// 🔹 STEP 1: Generate the OAuth URL for user authentication
app.get('/auth', (req, res) => {
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/calendar'],
        prompt: 'consent',
    });

    console.log("🔗 Redirecting to Google OAuth:", authUrl);
    res.redirect(authUrl);
});

app.post("/refresh-token", async (req, res) => {
    console.log("🔄 Refresh token API hit at:", new Date().toISOString());
  
    try {
      const refreshToken = process.env.REFRESH_TOKEN; 
      const clientId = process.env.CLIENT_ID;
      const clientSecret = process.env.CLIENT_SECRET;
  
      const tokenUrl = "https://oauth2.googleapis.com/token";
      const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token"
      });
  
      console.log("🔄 Requesting new access token from Google...");
  
      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params,
      });
  
      if (!response.ok) {
        const errorData = await response.json();
        console.error("❌ Failed to refresh token:", errorData);
        return res.status(500).json({ error: errorData });
      }
  
      const tokenData = await response.json();
      console.log("✅ New access token received:", tokenData.access_token);
  
      // ✅ Update tokens.json
      const fs = require("fs");
      const tokens = {
        access_token: tokenData.access_token,
        refresh_token: refreshToken, // Keep the same refresh token
        expires_in: tokenData.expires_in,
        expiry_date: Date.now() + tokenData.expires_in * 1000
      };
  
      fs.writeFileSync("tokens.json", JSON.stringify(tokens, null, 2));
      console.log("✅ tokens.json updated successfully!");
  
      res.json({ accessToken: tokenData.access_token, expiresIn: tokenData.expires_in });
  
    } catch (error) {
      console.error("❌ Error in refresh-token API:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });
  
  
  

// 🔹 STEP 2: Handle OAuth Callback (Exchange Code for Tokens)
app.get('/oauth2callback', async (req, res) => {
    const code = req.query.code;

    if (!code) {
        return res.status(400).json({ error: 'Authorization code missing' });
    }

    try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);
        saveTokens(tokens);  // Save tokens for future use

        res.json({ message: "Authentication successful!", tokens });
    } catch (error) {
        console.error("Error getting OAuth tokens:", error);
        res.status(500).json({ error: 'Failed to authenticate' });
    }
});



// 🔹 STEP 3: Load stored tokens
function loadStoredTokens() {
    if (fs.existsSync('tokens.json')) {
        const tokens = JSON.parse(fs.readFileSync('tokens.json'));
        oauth2Client.setCredentials(tokens);
    }
}
loadStoredTokens();

async function updateAirtableWithEventId(airtableRecordId, googleEventId) {
    const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ/${airtableRecordId}`;
    const updateData = { fields: { GoogleEventId: googleEventId } };

    try {
        const response = await fetch(url, {
            method: 'PATCH',
            headers: {
                Authorization: 'patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(updateData),
        });

        const data = await response.json();
        console.log(`✅ Airtable updated: ${airtableRecordId} → Google Event ID: ${googleEventId}`);
    } catch (error) {
        console.error("❌ Error updating Airtable:", error);
    }
}



setInterval(async () => {
    console.log("🔄 Checking Airtable for new events...");
}, 15 * 60 * 1000);  // Run every 15 minutes


async function refreshAccessToken() {
    try {
        const tokens = loadTokens();
        if (!tokens || !tokens.refresh_token) {
            console.error("❌ No refresh token available. User must log in again.");
            return null;
        }

        console.log("🔄 Checking if token needs to be refreshed...");

        const currentTime = Date.now();
        if (tokens.expiry_date && tokens.expiry_date - currentTime > 300000) {  // 5 minutes before expiry
            console.log("✅ Token is still valid, no need to refresh.");
            return tokens.access_token;
        }

        console.log("🔄 Refreshing Access Token...");

        const response = await axios.post("https://oauth2.googleapis.com/token", null, {
            params: {
                client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                refresh_token: tokens.refresh_token,
                grant_type: "refresh_token",
            },
        });

        const newTokens = response.data;
        newTokens.expiry_date = Date.now() + newTokens.expires_in * 1000;

        fs.writeFileSync("tokens.json", JSON.stringify(newTokens, null, 2));
        console.log("✅ New Access Token:", newTokens.access_token);
        
        return newTokens.access_token;
    } catch (error) {
        console.error("❌ Token refresh failed:", error.message);
        return null;
    }
}



// Function to save tokens
function saveTokens(tokens) {
    if (!tokens.refresh_token) {
        console.warn("⚠️ Warning: No refresh token available. User may need to re-authenticate.");
    }
    fs.writeFileSync('tokens.json', JSON.stringify(tokens, null, 2));
    console.log("✅ Tokens saved successfully.");
}



// Function to load tokens (if they exist)
function loadTokens() {
    if (fs.existsSync('tokens.json')) {
        return JSON.parse(fs.readFileSync('tokens.json'));
    }
    return null;
}

async function listCalendars() {
    try {
        oauth2Client.setCredentials(loadTokens()); // Ensure credentials are loaded

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        const response = await calendar.calendarList.list();

        console.log("📆 Available Calendars:");
        response.data.items.forEach(cal => {
            console.log(`- ${cal.summary}: ${cal.id}`);
        });

    } catch (error) {
        console.error("❌ Error listing calendars:", error.response ? error.response.data : error.message);
    }
}

// Call this function once after starting the server
listCalendars();

(async () => {
    console.log("🔄 Manually refreshing token...");
    await refreshAccessToken();
})();


// Automatically refresh the access token every 45 minutes (before it expires)
setInterval(async () => {
    console.log("🔄 Checking token expiration and refreshing if needed...");
    const newToken = await refreshAccessToken();
    
    if (!newToken) {
        console.warn("⚠️ No valid token found. User may need to log in.");
    }
}, 45 * 60 * 1000);  // Run every 45 minutes


async function createEvent(eventData, calendarId) {
    try {
        oauth2Client.setCredentials(loadTokens()); // Ensure credentials are loaded

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        const event = {
            summary: eventData.title,
            description: eventData.description || "No description provided",
            start: { dateTime: eventData.startDate, timeZone: "America/New_York" },
            end: { dateTime: eventData.endDate, timeZone: "America/New_York" },
            location: eventData.location || "Unknown Location",
        };

        const response = await calendar.events.insert({
            auth: oauth2Client,
            calendarId: calendarId,
            resource: event,
        });

        return response.data;
    } catch (error) {
        console.error("❌ Error creating Google Calendar event:", error);
        return null;
    }
}


// 🔹 API Endpoint to Create an Event
app.post('/create-event', async (req, res) => {
    const { eventData, calendarId, airtableRecordId } = req.body;

    if (!eventData || !calendarId || !airtableRecordId) {
        return res.status(400).json({ message: "Missing required fields: eventData, calendarId, or airtableRecordId" });
    }

    const createdEvent = await createEvent(eventData, calendarId);

    if (createdEvent) {
        console.log(`✅ Event created successfully: ${createdEvent.id}`);

        // ✅ Call function to update Airtable with the new Google Event ID
        await updateAirtableWithEventId(airtableRecordId, createdEvent.id);

        return res.status(200).json({ message: "Event created and Airtable updated!", eventId: createdEvent.id });
    } else {
        return res.status(500).json({ message: "Failed to create event" });
    }
});


// 🔹 Start Server
app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
});
