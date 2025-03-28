require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs');
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const bodyParser = require('body-parser');

module.exports = { loadTokens, refreshAccessToken, saveTokens };

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PORT = process.env.PORT || 5001;
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://warrentycalender.vanirinstalledsales.info//oauth2callback';

const app = express();

app.use(express.json());  // Make sure you can parse JSON requests

// Set up OAuth2 client
const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const corsOptions = {
    origin: function (origin, callback) {
      const allowedOrigins = [
        'https://warrentycalender.vanirinstalledsales.info',
        'http://localhost:3001'
      ];
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('❌ Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };
  
  app.use(cors(corsOptions));
  app.options('*', cors(corsOptions)); // 🔥 Handle preflight requests globally
  
  

// ✅ Load stored tokens when the server starts
function loadTokens() {
    if (fs.existsSync("tokens.json")) {
        const tokens = JSON.parse(fs.readFileSync("tokens.json", "utf8"));
        
        if (!tokens.refresh_token) {
            console.error("❌ No refresh token found in tokens.json. User must log in again.");
            return null;
        }

        return tokens;
    }
    console.error("❌ tokens.json not found. User must log in.");
    return null;
}

const tokens = loadTokens();
if (tokens) {
    oauth2Client.setCredentials(tokens);
    console.log("✅ Loaded existing tokens from tokens.json");
} else {
    console.log("⚠️ No existing tokens found. User must authenticate.");
}





// ✅ Function to save tokens to `tokens.json`
function saveTokens(tokens) {
    try {
        if (!tokens || !tokens.access_token) {
            console.error("❌ Invalid token data. Tokens not saved.");
            return;
        }

        // Keep the refresh token if it's missing in the new token response
        let existingTokens = {};
        if (fs.existsSync("tokens.json")) {
            existingTokens = JSON.parse(fs.readFileSync("tokens.json", "utf8"));
        }

        // Merge new tokens with existing ones (preserve refresh token)
        const updatedTokens = {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token || existingTokens.refresh_token, // Keep old refresh token if missing
            token_type: "Bearer",
            expiry_date: Date.now() + (tokens.expires_in * 1000 || 3600 * 1000), // Ensure expiry time is stored
        };

        // Save updated tokens to tokens.json
        fs.writeFileSync("tokens.json", JSON.stringify(updatedTokens, null, 2));

        console.log("✅ Tokens saved successfully.");
    } catch (error) {
        console.error("❌ Error saving tokens:", error);
    }
}
app.post("/save-tokens", (req, res) => {
    try {
        const tokens = req.body;

        if (!tokens || !tokens.access_token) {
            return res.status(400).json({ error: "Invalid token data" });
        }

        // ✅ Save tokens using fs
        fs.writeFileSync("tokens.json", JSON.stringify(tokens, null, 2));

        res.json({ message: "✅ Tokens saved successfully!" });
    } catch (error) {
        console.error("❌ Failed to save tokens:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.get("/", (req, res) => {
    res.send("✅ Server is running! Use the correct API endpoint.");
});


// ✅ Function to refresh the access token
async function refreshAccessToken() {
    try {
        const tokens = loadTokens();
        if (!tokens || !tokens.refresh_token) {
            console.error("❌ No refresh token available. User must log in again.");
            return null;
        }

        console.log("🔄 Refreshing Access Token...");

        const response = await axios.post("https://oauth2.googleapis.com/token", null, {
            params: {
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                refresh_token: tokens.refresh_token,
                grant_type: "refresh_token",
            },
        });

        const newTokens = response.data;
        newTokens.refresh_token = tokens.refresh_token; // Keep existing refresh token
        newTokens.expiry_date = Date.now() + newTokens.expires_in * 1000;

        // ✅ Ensure token is stored properly
        saveTokens(newTokens);
        oauth2Client.setCredentials(newTokens);

        console.log("✅ New Access Token:", newTokens.access_token);
        return newTokens.access_token;
    } catch (error) {
        console.error("❌ Token refresh failed:", error.message);
        return null;
    }
}



// 🔹 STEP 1: Google OAuth Authentication URL
app.get('/auth', (req, res) => {
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
            'https://www.googleapis.com/auth/calendar' // ✅ Allows event creation
        ],
        prompt: 'consent',
    });

    console.log("🔗 Redirecting to Google OAuth:", authUrl);
    res.redirect(authUrl);
});


// 🔹 STEP 2: OAuth Callback (Exchange Code for Tokens)
app.get('/oauth2callback', async (req, res) => {
    const code = req.query.code;

    if (!code) {
        return res.status(400).json({ error: 'Authorization code missing' });
    }

    try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);
        saveTokens(tokens);  // ✅ Save the tokens for future use

        res.json({ message: "Authentication successful!", tokens });
    } catch (error) {
        console.error("❌ Error getting OAuth tokens:", error);
        res.status(500).json({ error: 'Failed to authenticate' });
    }
});

app.post('/api/refresh-token', async (req, res) => {
    try {
        console.log("🔄 Received request to refresh token...");
        res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
        
        const tokens = loadTokens();
        if (!tokens || !tokens.refresh_token) {
            return res.status(400).json({ error: "No refresh token found. User must reauthenticate." });
        }

        const response = await axios.post("https://oauth2.googleapis.com/token", null, {
            params: {
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                refresh_token: tokens.refresh_token,
                grant_type: "refresh_token",
            },
        });

        const newTokens = response.data;
        newTokens.refresh_token = tokens.refresh_token; // Keep existing refresh token
        newTokens.expiry_date = Date.now() + newTokens.expires_in * 1000;

        saveTokens(newTokens); // ✅ Store new tokens
        oauth2Client.setCredentials(newTokens);

        console.log("✅ Token refreshed successfully:", newTokens.access_token);
        res.json(newTokens);
    } catch (error) {
        console.error("❌ Error refreshing token:", error.response?.data || error.message);
        res.status(500).json({ error: "Failed to refresh token" });
    }
});


  

// ✅ Endpoint to fetch stored tokens
app.get('/api/tokens', (req, res) => {
    try {
        const tokens = loadTokens();
        if (!tokens) {
            return res.status(404).json({ error: 'No tokens found. User must authenticate.' });
        }

        // ✅ Ensure tokens have an expiry date
        if (!tokens.expiry_date) {
            tokens.expiry_date = Date.now() + 3600 * 1000; // Set default expiry time (1 hour)
        }

        res.json(tokens);
    } catch (error) {
        res.status(500).json({ error: 'Failed to load tokens' });
    }
});





// ✅ Automatically refresh the access token every 45 minutes
setInterval(async () => {
    console.log("🔄 Checking token expiration and refreshing if needed...");
    if (!isAccessTokenValid()) {
        await refreshAccessToken();
    } else {
        console.log("✅ Token still valid. Skipping refresh.");
    }
}, 10 * 60 * 1000); // check every 10 mins for more accuracy


// ✅ API Endpoint to Create an Event
app.post('/create-event', async (req, res) => {
    const { eventData, calendarId } = req.body;

    if (!eventData || !calendarId) {
        return res.status(400).json({ message: "Missing required fields: eventData or calendarId" });
    }

    try {
        oauth2Client.setCredentials(loadTokens());

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

        console.log(`✅ Event created successfully: ${response.data.id}`);
        res.status(200).json({ message: "Event created successfully!", eventId: response.data.id });
    } catch (error) {
        console.error("❌ Error creating Google Calendar event:", error);
        res.status(500).json({ message: "Failed to create event" });
    }
});

// 🔹 Start Server
app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
});
