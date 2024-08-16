import React, { useState, useEffect } from 'react';
import './App.css';
import { useSession, useSupabaseClient, useSessionContext } from '@supabase/auth-helpers-react';
import DateTimePicker from 'react-datetime-picker';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';

function CalendarSection({ calendarId, calendarName, session }) {
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
    if (session) {
      fetchEvents();
    }
  }, [session]);

  async function fetchEvents(pageToken = '') {
    const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?${pageToken && `pageToken=${pageToken}`}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': 'Bearer ' + session.provider_token
      }
    });

    const data = await response.json();
    if (data.error) {
      console.error('Error fetching events:', data.error);
      return;
    }

    const fetchedEvents = data.items.map(event => {
      // Check if the event has time specified; otherwise, set default time
      const start = event.start.dateTime ? new Date(event.start.dateTime) : new Date(event.start.date);
      const end = event.end.dateTime ? new Date(event.end.dateTime) : new Date(event.end.date);

      if (!event.start.dateTime) {
        start.setHours(8, 0, 0); // Set start time to 8 AM
      }

      if (!event.end.dateTime) {
        end.setHours(20, 0, 0); // Set end time to 8 PM
      }

      return {
        id: event.id,
        title: event.summary,
        start: start,
        end: end,
        description: event.description || '',
      };
    });

    setEvents(prevEvents => [...prevEvents, ...fetchedEvents]);

    // Handle pagination by checking if there's a nextPageToken
    if (data.nextPageToken) {
      fetchEvents(data.nextPageToken);
    }
  }

  function handleDateClick(date) {
    if (selectedDate && selectedDate.toDateString() === date.toDateString()) {
      // If the same day is clicked, toggle the inputs
      setShowInputs(!showInputs);
      setSelectedDate(showInputs ? null : date);
    } else {
      const dayEvents = events.filter(
        event => event.start.toDateString() === date.toDateString()
      );
      setSelectedDate(date);
      setStart(date);
      setEnd(date);
      setSelectedEvents(dayEvents || []);
      setEditingEvent(null);
      setShowInputs(true); // Show inputs when a new date is clicked
    }
  }

  function handleEventClick(event) {
    setEditingEvent(event);
    setStart(event.start);
    setEnd(event.end);
    setEventName(event.title);
    setEventDescription(event.description);
    setShowInputs(true); // Ensure inputs are shown when an event is selected
  }

  async function saveEvent() {
    const event = {
      summary: eventName,
      description: eventDescription,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    };

    let url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;
    let method = "POST";

    if (editingEvent) {
      // If editing an event, update it
      url += `/${editingEvent.id}`;
      method = "PUT";
    }

    await fetch(url, {
      method: method,
      headers: {
        'Authorization': 'Bearer ' + session.provider_token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(event)
    }).then((data) => data.json())
      .then(() => {
        alert("Event saved!");
        fetchEvents(); // Refresh events after saving
        resetForm();
      });
  }

  function resetForm() {
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
    { id: 'c_d113e252e0e5c8cfbf17a13149707a30d3c0fbeeff1baaac7a46940c2cc448ca@group.calendar.google.com', name: 'Charleston' },
    { id: 'c_03867438b82e5dfd8d4d3b6096c8eb1c715425fa012054cc95f8dea7ef41c79b@group.calendar.google.com', name: 'Greensboro' },
    { id: 'c_ad562073f4db2c47279af5aa40e53fc2641b12ad2497ccd925feb220a0f1abee@group.calendar.google.com', name: 'Myrtle Beach' },
    { id: 'c_45db4e963c3363676038697855d7aacfd1075da441f9308e44714768d4a4f8de@group.calendar.google.com', name: 'Wilmington' },
    { id: 'https://calendar.google.com/calendar/embed?src=c_0476130ac741b9c58b404c737a8068a8b1b06ba1de2a84cff08c5d15ced54edf%40group.calendar.google.com&ctz=America%2FToronto', name: 'Grenville'},
    { id: 'https://calendar.google.com/calendar/embed?src=c_df033dd6c81bb3cbb5c6fdfd58dd2931e145e061b8a04ea0c13c79963cb6d515%40group.calendar.google.com&ctz=America%2FToronto', name: 'Columbia'},
    { id: 'warranty@vanirinstalledsales.com', name: 'Warranty' }
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
