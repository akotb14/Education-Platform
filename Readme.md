<div align="center">

# 🎓 Education Platform

A full-featured online learning platform built with **Express.js**, **JavaScript**, **MongoDB**, **EJS**, and **Multer**, enabling instructors to manage courses and students to access educational content through a clean and intuitive interface.

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js)
![Express.js](https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb)
![EJS](https://img.shields.io/badge/EJS-8BC34A?style=for-the-badge)
![Multer](https://img.shields.io/badge/Multer-File%20Upload-blue?style=for-the-badge)

</div>

---

# 📖 Overview

Education Platform is a web application designed to simplify online learning by providing instructors with powerful tools to create and manage courses while giving students an easy way to browse, enroll, and access learning materials.

The application follows a structured Express.js architecture and provides authentication, course management, file uploads, and a responsive user interface rendered with EJS.

---

# ✨ Features

## 🔐 Authentication

- User Registration
- User Login
- Secure Password Hashing
- Session Authentication
- Protected Routes

---

## 👨‍🏫 Instructor Features

- Create Courses
- Edit Courses
- Delete Courses
- Upload Course Images
- Upload Learning Materials
- Manage Lessons
- View Student Enrollments

---

## 🎓 Student Features

- Browse Courses
- View Course Details
- Enroll in Courses
- Access Lessons
- View Uploaded Materials

---

## 📂 File Management

- Upload Images
- Upload Course Files
- File Validation
- Secure Storage using Multer

---

## 📚 Course Management

- Course Information
- Lesson Organization
- Categories
- Course Thumbnail
- Instructor Information

---

# 🏗 Architecture

```
Client (Browser)
        │
      Express.js
        │
 Controllers
        │
 Business Logic
        │
 MongoDB
```

---

# 🛠 Tech Stack

## Backend

- Node.js
- Express.js
- JavaScript
- MongoDB
- Mongoose
- Express Session / Authentication
- Multer

## Frontend

- EJS
- HTML5
- CSS3
- Bootstrap
- JavaScript

---

# 📂 Project Structure

```text
Education-Platform
│
├── controllers
├── models
├── routes
├── middleware
├── uploads
├── public
│
├── views
│   ├── layouts
│   ├── auth
│   ├── courses
│   ├── dashboard
│   └── student
│
├── config
├── app.js
├── package.json
└── README.md
```

---

# 🚀 Getting Started

## Clone Repository

```bash
git clone https://github.com/akotb14/Education-Platform.git
```

---

## Install Dependencies

```bash
npm install
```

---

## Configure Environment Variables

Create a `.env` file in the project root.

```env
PORT=5000

MONGO_URI=your_mongodb_connection

SESSION_SECRET=your_session_secret
```

---

## Run the Application

Development

```bash
npm run dev
```

Production

```bash
npm start
```

---


# 📚 Key Features Demonstrated

- Express.js MVC Architecture
- Authentication & Authorization
- CRUD Operations
- Dynamic Server-Side Rendering with EJS
- MongoDB Integration
- File Uploads with Multer
- Form Validation
- Route Protection
- Responsive UI

---

# 🚀 Future Improvements

- Video Streaming
- Online Payments
- Certificates
- Quizzes & Exams
- Progress Tracking
- Student Dashboard
- Instructor Analytics
- Email Notifications
- Live Chat
- Docker Support
- Unit Testing
- CI/CD Pipeline

---

# 👨‍💻 Author

**Ahmed Mohammed Kotb**

Backend Developer (.NET & Node.js)

- GitHub: https://github.com/akotb14


---

# ⭐ Support

If you found this project helpful, please consider giving it a **⭐ Star** on GitHub.

Contributions, suggestions, and feedback are always welcome!

```