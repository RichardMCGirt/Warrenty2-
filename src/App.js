import React, { useState, useEffect } from 'react';
import './App.css';
import { useSession, useSupabaseClient, useSessionContext } from '@supabase/auth-helpers-react';
import DateTimePicker from 'react-datetime-picker';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function patchGoogleCalendarEvent(event, calendarId, session, signOut) {
  console.log('Attempting to patch Google Calendar event:', event);

  if (!session.provider_token) {
    console.error('No valid session token available. Logging out.');
    signOut();
    return;
  }

  if (!event.googleEventId) {
    console.log('No googleEventId found for event. Creating a new event:', event);
    const googleEventId = await createGoogleCalendarEvent(event, calendarId, session, signOut);
    if (googleEventId) {
      console.log('New Google Event ID created:', googleEventId);
      await updateAirtableWithGoogleEventId(event.id, googleEventId);
    }
    return;
  }

  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${event.googleEventId}`;
  console.log('Patching event at URL:', url);

  const updatedEvent = {
    summary: event.title,
    description: event.description,
    start: { dateTime: event.start.toISOString() },
    end: { dateTime: event.end.toISOString() },
    location: `${event.streetAddress}, ${event.city}, ${event.state}, ${event.zipCode}`,
  };

  console.log('Updated event data:', updatedEvent);

  await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': 'Bearer ' + session.provider_token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updatedEvent)
  }).then(response => response.json())
    .then(async data => {
      console.log('Google Calendar API response for patch:', data);
      if (data.error) {
        console.error('Error updating event:', data.error);
        if (data.error.status === "PERMISSION_DENIED" && data.error.message.includes('Quota exceeded')) {
          console.log('Rate limit exceeded, retrying after delay...');
          await delay(10000);
          return patchGoogleCalendarEvent(event, calendarId, session, signOut);
        }
      } else {
        console.log('Event successfully updated:', data);
      }
    }).catch(error => console.error('Error during fetch request:', error));
}

async function createGoogleCalendarEvent(event, calendarId, session, signOut) {
  console.log('Attempting to create a new Google Calendar event:', event);

  if (!session.provider_token) {
    console.error('No valid session token available. Logging out.');
    signOut();
    return null;
  }

  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;

  const newEvent = {
    summary: event.title,
    description: event.description,
    start: { dateTime: event.start.toISOString() },
    end: { dateTime: event.end.toISOString() },
    location: `${event.streetAddress}, ${event.city}, ${event.state}, ${event.zipCode}`,
  };

  console.log('New event data:', newEvent);

  return await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + session.provider_token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(newEvent)
  }).then(response => response.json())
    .then(data => {
      console.log('Google Calendar creation response:', data);
      if (data.error) {
        console.error('Error creating event:', data.error);
        return null;
      } else {
        console.log('New event successfully created:', data);
        return data.id;
      }
    }).catch(error => console.error('Error during fetch request:', error));
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

  return await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updateData)
  }).then(response => response.json())
    .then(data => {
      console.log('Airtable API response for update:', data);
      if (data.error) {
        console.error('Error updating Airtable with Google Event ID:', data.error);
      } else {
        console.log('Airtable record successfully updated:', data);
      }
    }).catch(error => console.error('Error during fetch request:', error));
}

async function fetchAirtableEvents() {
  console.log('Fetching events from Airtable');

  const url = `https://api.airtable.com/v0/appO21PVRA4Qa087I/tbl6EeKPsNuEvt5yJ`;
  const response = await fetch(url, {
    headers: {
      'Authorization': 'Bearer patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238',
      'Content-Type': 'application/json'
    }
  });

  const data = await response.json();
  console.log('Fetched data from Airtable:', data);

  return data.records
    .filter(record => record.fields['Calendar Event Name'] && record.fields['startDate'] && record.fields['endDate']) // Skip empty records
    .map(record => ({
      id: record.id,
      title: record.fields['Calendar Event Name'] || "Untitled Event", // Use 'Calendar Event Name' for the event title
      start: new Date(record.fields['startDate']),
      end: new Date(record.fields['endDate']),
      description: record.fields['Billable Reason (If Billable)'] || '',
      branch: record.fields['b'] || 'Unknown',
      homeownerName: record.fields['Homeowner Name'] || 'Unknown',
      streetAddress: record.fields['Street Address'] || 'Unknown',
      city: record.fields['City'] || 'Unknown',
      state: record.fields['State'] || 'Unknown',
      zipCode: record.fields['Zip Code'] || 'Unknown',
      picturesOfIssue: record.fields['Picture(s) of Issue'] || '',
      calendarLink: record.fields['Calendar Link'] || '',
      vendorEmail: record.fields['Vendor Email'] || '',
      googleEventId: record.fields['GoogleEventId'] || null,
    }));
}

function CalendarSection({ calendarId, calendarName, session, signOut }) {
  const [start, setStart] = useState(new Date());
  const [end, setEnd] = useState(new Date());
  const [eventName, setEventName] = useState("");
  const [eventDescription, setEventDescription] = useState("");
  const [events, setEvents] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedEvents, setSelectedEvents] = useState([]);
  const [editingEvent, setEditingEvent] = useState(null);
  const [showInputs, setShowInputs] = useState(false);

  useEffect(() => {
    console.log('Session state:', session);
    if (session) {
      if (!session.provider_token) {
        console.error('No valid session token found. Logging out.');
        signOut();
        return;
      }
      console.log('Fetching events from Google Calendar');
      fetchEvents();
      fetchAirtableEvents().then(airtableEvents => {
        console.log("Fetched Airtable events:", airtableEvents);
        airtableEvents.forEach(event => {
          console.log("Processing event:", event);
          patchGoogleCalendarEvent(event, calendarId, session, signOut);
        });
      }).catch(error => console.error("Error fetching Airtable events:", error));
    }
  }, [session, signOut]);

  async function fetchEvents(pageToken = '') {
    console.log('Fetching Google Calendar events with pageToken:', pageToken);

    const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?${pageToken && `pageToken=${pageToken}`}`;
    console.log('Google Calendar events fetch URL:', url);

    const response = await fetch(url, {
      headers: {
        'Authorization': 'Bearer ' + session.provider_token
      }
    });

    const data = await response.json();
    console.log('Google Calendar events fetch response:', data);

    if (data.error) {
      console.error('Error fetching Google Calendar events:', data.error);
      return;
    }

    const fetchedEvents = data.items.map(event => {
      // Check if event.start and event.end exist
      const start = event.start?.dateTime ? new Date(event.start.dateTime) : event.start?.date ? new Date(event.start.date) : null;
      const end = event.end?.dateTime ? new Date(event.end.dateTime) : event.end?.date ? new Date(event.end.date) : null;

      if (!start) {
        console.error('Event start date is missing:', event);
        return null; // Skip this event if start date is missing
      }

      if (!end) {
        console.error('Event end date is missing:', event);
        return null; // Skip this event if end date is missing
      }

      if (!event.start.dateTime) {
        start.setHours(8, 0, 0);
      }

      if (!event.end.dateTime) {
        end.setHours(20, 0, 0);
      }

      return {
        id: event.id,
        title: event.summary,
        start: start,
        end: end,
        description: event.description || '',
      };
    }).filter(event => event !== null); // Filter out any events that were skipped due to missing dates

    console.log('Fetched events from Google Calendar:', fetchedEvents);

    setEvents(prevEvents => [...prevEvents, ...fetchedEvents]);

    if (data.nextPageToken) {
      fetchEvents(data.nextPageToken);
    }
}


  function handleDateClick(date) {
    console.log('Date clicked:', date);
    if (selectedDate && selectedDate.toDateString() === date.toDateString()) {
      setShowInputs(!showInputs);
      setSelectedDate(showInputs ? null : date);
    } else {
      const dayEvents = events.filter(
        event => event.start.toDateString() === date.toDateString()
      );
      console.log('Events on selected date:', dayEvents);
      setSelectedDate(date);
      setStart(date);
      setEnd(date);
      setSelectedEvents(dayEvents || []);
      setEditingEvent(null);
      setShowInputs(true);
    }
  }

  function handleEventClick(event) {
    console.log('Event clicked:', event);
    setEditingEvent(event);
    setStart(event.start);
    setEnd(event.end);
    setEventName(event.title);
    setEventDescription(event.description);
    setShowInputs(true);
  }

  async function saveEvent() {
    console.log('Saving event:', { eventName, eventDescription, start, end });

    const event = {
      summary: eventName,
      description: eventDescription,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    };
  
    let calendarId = 'primary'; // Use 'primary' if referring to the signed-in user's primary calendar
    let url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;
    let method = "POST";
  
    if (editingEvent) {
      url += `/${editingEvent.id}`;
      method = "PUT";
    }

    console.log('Google Calendar event save URL:', url);
    console.log('Method:', method);
    console.log('Event data to save:', event);
  
    await fetch(url, {
      method: method,
      headers: {
        'Authorization': 'Bearer ' + session.provider_token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(event)
    }).then((response) => {
      console.log('Google Calendar save response:', response);
      if (!response.ok) {
        console.error(`Error saving event: ${response.statusText}`);
        throw new Error(`Error saving event: ${response.statusText}`);
      }
      return response.json();
    })
    .then(() => {
      alert("Event saved!");
      fetchEvents();
      resetForm();
    })
    .catch(error => console.error('Error during saveEvent:', error));
  }
  

  function resetForm() {
    console.log('Resetting form');
    setEventName("");
    setEventDescription("");
    setStart(new Date());
    setEnd(new Date());
    setEditingEvent(null);
    setShowInputs(false);
  }

  function tileContent({ date, view }) {
    if (view === 'month') {
      const dayEvents = events.filter(
        event => event.start.toDateString() === date.toDateString()
      );
      return dayEvents.length > 0 ? <div className="event-dot"></div> : null;
    }
  }

  return (
    <div className="calendar-item">
      <h2>{calendarName}</h2>
      <Calendar
        onClickDay={handleDateClick}
        value={selectedDate || new Date()}
        tileContent={tileContent}
      />
      {selectedEvents.length > 0 && (
        <div>
          <h3>Events on {selectedDate?.toDateString()}</h3>
          <ul>
            {selectedEvents.map((event, index) => (
              <li key={index} onClick={() => handleEventClick(event)}>
                <strong>{event.title}</strong><br />
                {event.description && <em>{event.description}</em>}<br />
                {event.start.toLocaleTimeString()} - {event.end.toLocaleTimeString()}
              </li>
            ))}
          </ul>
        </div>
      )}
      {showInputs && (
        <>
          <p>Start of your event</p>
          <DateTimePicker onChange={setStart} value={start} />
          <p>End of your event</p>
          <DateTimePicker onChange={setEnd} value={end} />
          <p>Event name</p>
          <input type="text" value={eventName} onChange={(e) => setEventName(e.target.value)} />
          <p>Event description</p>
          <input type="text" value={eventDescription} onChange={(e) => setEventDescription(e.target.value)} />
          <hr />
          <button onClick={saveEvent}>
            {editingEvent ? "Update Event" : "Create Event"} in {calendarName}
          </button>
          {editingEvent && <button onClick={resetForm}>Cancel Editing</button>}
        </>
      )}
    </div>
  );
}

function App() {
  const session = useSession();
  const supabase = useSupabaseClient();
  const { isLoading } = useSessionContext();

  const calendarInfo = [
    { id: 'rmcgirt55@gmail.com', name: 'rmcgirt55@gmail.com' }
  ];

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
                    signOut={() => supabase.auth.signOut()}  // Pass the signOut function
                  />
                ))}
              </div>
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
