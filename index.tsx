import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AlertProvider } from './components/GlobalAlert';
import { LocaleProvider } from './contexts/LocaleContext';
import { AuthProvider } from './contexts/AuthContext';
import AuthGate from './components/auth/AuthGate';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <LocaleProvider>
      <AuthProvider>
        <AuthGate>
          <AlertProvider>
            <App />
          </AlertProvider>
        </AuthGate>
      </AuthProvider>
    </LocaleProvider>
  </React.StrictMode>
);
