import React from 'react';
import { createRoot } from 'react-dom/client';
import { PublisherPage } from './PublisherPage';
import '../styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('The publisher root element is missing.');
createRoot(root).render(
  <React.StrictMode>
    <PublisherPage />
  </React.StrictMode>
);
