import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.6.0/index.js';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR'];

/** Amount in minor units, 1.00 - 500.00. */
export const randomAmount = () => 100 + Math.floor(Math.random() * 49_901);

export const randomCurrency = () => CURRENCIES[Math.floor(Math.random() * CURRENCIES.length)];

/** Unique per payment attempt; reused only for the deliberate retry. */
export const idempotencyKey = () => uuidv4();
