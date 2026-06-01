import Stripe from 'stripe';
import { env } from '../env.js';

export const stripe = new Stripe(env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  // apiVersionは未指定でSDK既定に従う
  maxNetworkRetries: 2,
});

// raw body と署名ヘッダから Stripe イベントを検証・復元
export function verifyStripeEvent(rawBody: string, signature: string): Stripe.Event {
  return stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
}
