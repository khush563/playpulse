'use strict';

const { offerMetrics, publicOffer } = require('./offer-catalogue');

function fundingSplit(discountMinor, source, vendorFundingPercent) {
  const discount = Number.isSafeInteger(discountMinor) && discountMinor >= 0 ? discountMinor : 0;
  const vendorPercent = source === 'vendor' ? 100 : source === 'sponsor' ? 0 : vendorFundingPercent;
  if (!Number.isSafeInteger(vendorPercent) || vendorPercent < 0 || vendorPercent > 100) {
    throw new Error('A valid vendor funding percentage is required.');
  }
  const merchant = Math.round(discount * vendorPercent / 100);
  return { merchant_funded_discount_minor: merchant, sponsor_funded_discount_minor: discount - merchant };
}

function computeMerchantAnalytics(catalogue, runtimeCampaigns) {
  const campaigns = [...runtimeCampaigns];
  const byCampaign = catalogue.offers.map(offer => campaignAnalytics(catalogue, offer, campaigns));
  const totals = byCampaign.reduce((sum, item) => {
    for (const key of [
      'triggered_events', 'impressions', 'claims', 'completed_orders', 'redemptions',
      'order_cancellations', 'campaign_expiries', 'campaign_cancellations',
      'gross_order_value_minor', 'discount_amount_minor', 'merchant_funded_discount_minor',
      'sponsor_funded_discount_minor', 'budget_consumed_minor', 'campaign_budget_minor'
    ]) sum[key] += item[key];
    return sum;
  }, emptyTotals());
  totals.budget_remaining_minor = Math.max(0, totals.campaign_budget_minor - totals.budget_consumed_minor);
  totals.average_order_value_minor = safeAverage(totals.gross_order_value_minor, totals.completed_orders);
  totals.redemption_rate = safeRate(totals.redemptions, totals.claims);
  totals.claim_rate = safeRate(totals.claims, totals.impressions);
  totals.has_activity = totals.impressions + totals.claims + totals.completed_orders + totals.order_cancellations > 0;
  return {
    generated_at: Date.now(),
    source: 'local_in_memory_records',
    definitions: metricDefinitions(),
    totals,
    campaigns: byCampaign
  };
}

function campaignAnalytics(catalogue, offer, campaigns) {
  const related = campaigns.filter(campaign => campaign.catalogue_offer_id === offer.offer_id
    || [...campaign.claims.values()].some(claim => claim.offer_id === offer.offer_id)
    || [...(campaign.impressions?.values() || [])].some(impression => impression.offer_id === offer.offer_id));
  const impressions = related.flatMap(campaign => [...(campaign.impressions?.values() || [])]).filter(item => item.offer_id === offer.offer_id);
  const claims = related.flatMap(campaign => [...campaign.claims.values()]).filter(item => item.offer_id === offer.offer_id);
  const completed = claims.filter(claim => claim.order_status === 'completed');
  const cancellations = claims.filter(claim => claim.order_status === 'cancelled');
  const redemptions = claims.filter(claim => claim.redemption_status === 'redeemed');
  const grossOrderValue = completed.reduce((sum, claim) => sum + (claim.order_value_minor || 0), 0);
  const discountAmount = completed.reduce((sum, claim) => sum + claim.discount_minor, 0);
  const split = completed.reduce((sum, claim) => {
    const part = fundingSplit(claim.discount_minor, claim.funding_source, claim.vendor_funding_percent);
    sum.merchant_funded_discount_minor += part.merchant_funded_discount_minor;
    sum.sponsor_funded_discount_minor += part.sponsor_funded_discount_minor;
    return sum;
  }, { merchant_funded_discount_minor: 0, sponsor_funded_discount_minor: 0 });
  const budget = offerMetrics(catalogue, offer);
  const publicData = publicOffer(catalogue, offer);
  return {
    offer_id: offer.offer_id,
    title: offer.title,
    vendor_id: offer.vendor_id,
    vendor_name: publicData.vendor_name,
    status: offer.status,
    triggered_events: related.filter(campaign => campaign.catalogue_offer_id === offer.offer_id).length,
    impressions: impressions.length,
    claims: claims.length,
    completed_orders: completed.length,
    redemptions: redemptions.length,
    order_cancellations: cancellations.length,
    campaign_expiries: related.filter(campaign => campaign.catalogue_offer_id === offer.offer_id && campaign.state === 'expired').length,
    campaign_cancellations: related.filter(campaign => campaign.catalogue_offer_id === offer.offer_id && campaign.state === 'cancelled').length,
    gross_order_value_minor: grossOrderValue,
    discount_amount_minor: discountAmount,
    ...split,
    average_order_value_minor: safeAverage(grossOrderValue, completed.length),
    redemption_rate: safeRate(redemptions.length, claims.length),
    claim_rate: safeRate(claims.length, impressions.length),
    budget_consumed_minor: budget.budget_consumed_minor,
    budget_remaining_minor: budget.budget_remaining_minor,
    campaign_budget_minor: offer.campaign_budget_minor,
    has_activity: impressions.length + claims.length + completed.length + cancellations.length > 0
  };
}

function contributionEstimate(analytics, input) {
  const unitCost = input.unit_cost_minor;
  const fulfilmentCost = input.fulfilment_cost_minor;
  if (!Number.isSafeInteger(unitCost) || unitCost < 0 || !Number.isSafeInteger(fulfilmentCost) || fulfilmentCost < 0) {
    return { ok: false, errors: { costs: 'Unit product cost and fulfilment cost must be non-negative amounts.' } };
  }
  const orders = analytics.completed_orders;
  const totalCosts = orders * (unitCost + fulfilmentCost);
  const sponsorReimbursement = analytics.sponsor_funded_discount_minor;
  const estimate = analytics.gross_order_value_minor + sponsorReimbursement - totalCosts;
  return {
    ok: true,
    estimate: {
      label: 'Estimated contribution',
      completed_orders: orders,
      gross_order_value_minor: analytics.gross_order_value_minor,
      sponsor_reimbursement_minor: sponsorReimbursement,
      unit_product_cost_minor: unitCost,
      unit_fulfilment_cost_minor: fulfilmentCost,
      total_cost_minor: totalCosts,
      estimated_contribution_minor: estimate,
      formula: 'gross order value after discount + sponsor-funded discount − (completed orders × (unit product cost + unit fulfilment cost))'
    }
  };
}

function safeAverage(total, count) { return count === 0 ? null : Math.round(total / count); }
function safeRate(numerator, denominator) { return denominator === 0 ? null : numerator / denominator; }
function emptyTotals() {
  return {
    triggered_events: 0, impressions: 0, claims: 0, completed_orders: 0, redemptions: 0,
    order_cancellations: 0, campaign_expiries: 0, campaign_cancellations: 0,
    gross_order_value_minor: 0, discount_amount_minor: 0, merchant_funded_discount_minor: 0,
    sponsor_funded_discount_minor: 0, budget_consumed_minor: 0, campaign_budget_minor: 0
  };
}
function metricDefinitions() {
  return {
    impression: 'One unique local user seeing one selected offer in one runtime campaign.',
    claim_rate: 'Coupon claims ÷ recorded offer impressions.',
    redemption_rate: 'Redeemed coupons ÷ all coupon claims.',
    average_order_value: 'Gross order value after discount ÷ completed demo orders.',
    budget_consumed: 'Discount committed by active local reservations; cancelled reservations are released.'
  };
}

module.exports = { fundingSplit, computeMerchantAnalytics, contributionEstimate, safeAverage, safeRate };
