'use strict';

module.exports = ({ strapi }) => ({
  getStatus() {
    return { status: 'ok' };
  },
});
