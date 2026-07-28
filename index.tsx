import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AlertProvider } from './components/GlobalAlert';
import { LocaleProvider } from './contexts/LocaleContext';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <LocaleProvider>
      <AlertProvider>
        <App />
      </AlertProvider>
    </LocaleProvider>
  </React.StrictMode>
);
