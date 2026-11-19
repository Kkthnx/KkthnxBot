/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

// Where the KkthnxUI support features read their release data from.

const SUPPORT_DEFAULTS = {
    repo: 'Kkthnx-Wow/KkthnxUI',
    curseforgeUrl: 'https://www.curseforge.com/wow/addons/kkthnxui',
    productName: 'KkthnxUI',
};

function supportSettings(env = process.env) {
    return {
        repo: (env.SUPPORT_GITHUB_REPO || '').trim() || SUPPORT_DEFAULTS.repo,
        curseforgeUrl: (env.SUPPORT_CURSEFORGE_URL || '').trim() || SUPPORT_DEFAULTS.curseforgeUrl,
        productName: SUPPORT_DEFAULTS.productName,
    };
}

module.exports = { supportSettings, SUPPORT_DEFAULTS };
