import pkg from "@prisma/client";

const { CostType } = pkg;

export function calcVariableCosts(templates, context) {
  const variableCosts = evaluateTemplates(templates, context);
  const totals = aggregateCostTotals(variableCosts);

  return {
    variableCosts,
    shippingCost: totals[CostType.SHIPPING] ?? 0,
    paymentFees: totals[CostType.PAYMENT_FEE] ?? 0,
    platformFees: totals[CostType.PLATFORM_FEE] ?? 0,
    customCosts: totals[CostType.CUSTOM] ?? 0,
  };
}

function evaluateTemplates(templates = [], context) {
  return templates
    .map((template) => {
      if (!template.lines?.length) {
        return null;
      }
      if (template.config?.gateway) {
        if (
          !context.paymentGateway ||
          template.config.gateway !== context.paymentGateway
        ) {
          return null;
        }
      }
      if (template.config?.channel) {
        if (template.config.channel !== context.channel) {
          return null;
        }
      }
      const amount = template.lines.reduce((sum, line) => {
        const baseAmount = resolveBaseAmount(line.appliesTo, template, context);
        const pct = line.percentageRate ? Number(line.percentageRate) : 0;
        const flat = line.flatAmount ? Number(line.flatAmount) : 0;
        return sum + baseAmount * pct + flat;
      }, 0);

      if (amount <= 0) {
        return null;
      }

      return {
        type: template.type,
        templateName: template.name,
        amount,
      };
    })
    .filter(Boolean);
}

function aggregateCostTotals(variableCosts = []) {
  return variableCosts.reduce((acc, cost) => {
    acc[cost.type] = (acc[cost.type] ?? 0) + cost.amount;
    return acc;
  }, {});
}

function resolveBaseAmount(appliesTo, template, context) {
  const target = appliesTo ?? template.config?.appliesTo ?? "ORDER_TOTAL";
  switch (target) {
    case "SUBTOTAL":
      return context.subtotal ?? 0;
    case "SHIPPING_REVENUE":
      return context.shippingRevenue ?? 0;
    case "ORDER_TOTAL":
    default:
      return context.orderTotal ?? context.subtotal ?? 0;
  }
}

