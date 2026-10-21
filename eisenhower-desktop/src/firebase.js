import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth"; // <-- NUEVO

const firebaseConfig = {
  apiKey: "AIzaSyC60t77D0P2JJBFIx8ZPFbaXOi-YtF6KlM",
  authDomain: "eisenhower-widget.firebaseapp.com",
  projectId: "eisenhower-widget",
  storageBucket: "eisenhower-widget.firebasestorage.app",
  messagingSenderId: "804130731802",
  appId: "1:804130731802:web:6dde48929f8009f7721ea3",
  measurementId: "G-9NBY5L8WXL"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app); // <-- NUEVO