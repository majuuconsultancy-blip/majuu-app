// firebase.js (REPLACE with this)
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCcWaFmHj10rbJXDmOD-IBCzX6pGQAbtUQ",
  authDomain: "majuu-app.firebaseapp.com",
  projectId: "majuu-app",
  storageBucket: "majuu-app.firebasestorage.app",
  messagingSenderId: "7815638736",
  appId: "1:7815638736:web:3cda5edc7add402454f8d5",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

// Google provider (export it)
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: "select_account",
});