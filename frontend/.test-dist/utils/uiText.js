"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pluralizeFr = pluralizeFr;
exports.countLabelFr = countLabelFr;
exports.formatEuroFr = formatEuroFr;
function pluralizeFr(count, singular, plural) {
    if (count === 1) {
        return singular;
    }
    return plural ?? `${singular}s`;
}
function countLabelFr(count, singular, plural) {
    return `${count} ${pluralizeFr(count, singular, plural)}`;
}
function formatEuroFr(amount, maximumFractionDigits = 1) {
    const formatted = new Intl.NumberFormat('fr-FR', {
        minimumFractionDigits: 0,
        maximumFractionDigits,
    }).format(amount);
    return `${formatted} €`;
}
