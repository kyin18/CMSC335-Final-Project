const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.set('view engine', 'ejs');

const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/taskweather';
mongoose.connect(mongoURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
})
.then(() => console.log('MongoDB Connected'))
.catch(err => {
    console.error('MongoDB Connection Error:', err.message);
    console.log('App starting without database connection');
});

const Task = require('./models/Task');

app.get('/', (req, res) => {
    res.render('home', { 
        title: 'TaskWeather Dashboard',
        error: null
    });
});

app.get('/tasks', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            throw new Error('Database not connected');
        }
        
        const tasks = await Task.find().sort({ taskDate: 1 });
        res.render('tasks', { 
            title: 'All Tasks',
            tasks,
            error: null
        });
    } catch (error) {
        console.error('Error loading tasks:', error.message);
        res.render('tasks', { 
            title: 'All Tasks',
            tasks: [],
            error: 'Database connection failed. Please try again later.'
        });
    }
});

app.get('/add', (req, res) => {
    res.render('add-task', { 
        title: 'Add New Task',
        error: null,
        task: null
    });
});

app.post('/add', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            throw new Error('Database not connected');
        }
        
        // Parse the date string (format: YYYY-MM-DD)
        const dateParts = req.body.taskDate.split('-');
        const year = parseInt(dateParts[0]);
        const month = parseInt(dateParts[1]) - 1; // JS months are 0-indexed
        const day = parseInt(dateParts[2]);
        
        let taskDateObj;
        
        if (req.body.taskTime) {
            // If there's a time, parse it
            const timeParts = req.body.taskTime.split(':');
            const hours = parseInt(timeParts[0]);
            const minutes = parseInt(timeParts[1] || 0);
            
            // Create date in UTC to avoid timezone issues
            taskDateObj = new Date(Date.UTC(year, month, day, hours, minutes));
            
        } else {
            // If no time specified, store just the date at midnight UTC
            taskDateObj = new Date(Date.UTC(year, month, day));
        }
        
        const newTask = new Task({
            activity: req.body.activity,
            city: req.body.city,
            state: req.body.state,
            country: req.body.country,
            taskDate: taskDateObj,
            taskTime: req.body.taskTime || null
        });
        
        await newTask.save();
        res.redirect('/tasks');
    } catch (error) {
        console.error('Error adding task:', error.message);
        res.render('add-task', { 
            title: 'Add New Task',
            error: 'Failed to add task. Database may be unavailable.',
            task: null
        });
    }
});

app.post('/delete/:id', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.redirect('/tasks?error=database');
        }
        
        await Task.findByIdAndDelete(req.params.id);
        res.redirect('/tasks');
    } catch (error) {
        console.error('Error deleting task:', error.message);
        res.redirect('/tasks');
    }
});

app.get('/weather/:taskId', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.json({ 
                success: false, 
                error: 'Database not available' 
            });
        }
        
        const task = await Task.findById(req.params.taskId);
        
        if (!task) {
            return res.json({ 
                success: false, 
                error: 'Task not found' 
            });
        }
        
        if (!process.env.OPENWEATHER_API_KEY) {
            console.error('OpenWeather API key not found');
            return res.json({ 
                success: false, 
                error: 'Weather service configuration error' 
            });
        }
        
        const location = `${task.city},${task.country}`;
        const apiKey = process.env.OPENWEATHER_API_KEY;
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&units=imperial&appid=${apiKey}`;
        
        console.log(`Fetching weather for: ${location}`);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await axios.get(url, { 
            signal: controller.signal,
            timeout: 10000 
        });
        
        clearTimeout(timeoutId);
        
        const weather = {
            success: true,
            location: response.data.name,
            temp: Math.round(response.data.main.temp),
            feels_like: Math.round(response.data.main.feels_like),
            humidity: response.data.main.humidity,
            description: response.data.weather[0].description,
            icon: `https://openweathermap.org/img/wn/${response.data.weather[0].icon}@2x.png`,
            wind: response.data.wind.speed,
            clouds: response.data.clouds.all,
            task: {
                activity: task.activity,
                date: task.taskDate.toLocaleDateString('en-US', {
                    weekday: 'short',
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                }),
                time: task.taskTime || 'All day',
                location: `${task.city}${task.state ? ', ' + task.state : ''}, ${task.country}`
            }
        };
        
        res.json(weather);
    } catch (error) {
        console.error('Weather API Error:', error.message);
        
        let errorMessage = 'Could not fetch weather data for this location';
        
        if (error.code === 'ECONNABORTED' || error.name === 'AbortError') {
            errorMessage = 'Weather request timed out. Please try again.';
        } else if (error.response) {
            if (error.response.status === 404) {
                errorMessage = 'Location not found. Please check the city and country.';
            } else if (error.response.status === 401) {
                errorMessage = 'Weather service authentication failed.';
            } else if (error.response.status === 429) {
                errorMessage = 'Too many weather requests. Please wait a moment.';
            } else {
                errorMessage = `Weather service error: ${error.response.status}`;
            }
        } else if (error.request) {
            errorMessage = 'No response from weather service. Please check your connection.';
        }
        
        res.json({ 
            success: false, 
            error: errorMessage 
        });
    }
});

app.get('/health', (req, res) => {
    const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        memory: process.memoryUsage(),
        environment: process.env.NODE_ENV || 'development'
    };
    
    res.status(200).json(health);
});

app.use((req, res) => {
    res.status(404).render('error', {
        title: 'Page Not Found',
        message: 'The page you are looking for does not exist.'
    });
});

app.use((err, req, res, next) => {
    console.error('Server Error:', err.stack);
    res.status(500).render('error', {
        title: 'Server Error',
        message: 'Something went wrong on our end. Please try again later.'
    });
});

app.listen(port, () => {
    console.log(`server started`);
});

process.on('SIGTERM', () => {
    console.log('SIGTERM received. Closing server...');
    mongoose.connection.close(false, () => {
        console.log('MongoDB connection closed.');
        process.exit(0);
    });
});