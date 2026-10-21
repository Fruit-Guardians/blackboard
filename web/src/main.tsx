import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import ELK from 'elkjs/lib/elk-api.js';
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url';
import { App } from './App';
import { configureElk } from './graph';
import { locale, t } from './i18n';

configureElk(() => new ELK({ workerUrl: elkWorkerUrl }));
document.documentElement.lang = locale;
document.title = t('app.title');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
