# syntax=docker/dockerfile:1
#
# The `runner` image (plan §5.1): the official Playwright image (browsers and their system
# libraries) plus Node 24, the version the app runs on. Every test command runs in it.
#
# PLAYWRIGHT_IMAGE must match the repo's pinned @playwright/test version (a test will check it
# once the e2e workspace exists). dev/run passes both build args; the defaults here are the
# same pins, for building by hand.

ARG PLAYWRIGHT_VERSION=1.65.1
ARG PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.65.1-noble@sha256:1507cbfc550a63a6b7396791ca4f00df17beb56342d2447b3f106c306f525579
ARG NODE_IMAGE=node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54

FROM ${NODE_IMAGE} AS node

FROM ${PLAYWRIGHT_IMAGE}
ARG PLAYWRIGHT_VERSION
LABEL org.opencontainers.image.description="wp-upload dev/test runner (Playwright ${PLAYWRIGHT_VERSION} + Node 24)"

# certutil puts the dev CA into Chromium's NSS database; git serves the version-bump check.
RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates git libnss3-tools \
  && rm -rf /var/lib/apt/lists/*

# The Playwright image ships a newer Node. /usr/local/bin comes first on PATH, so Node 24 and
# its npm win.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
  && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
  && node --version | grep -q '^v24\.'

ENV PLAYWRIGHT_VERSION=${PLAYWRIGHT_VERSION}
COPY --chmod=0755 entrypoint.sh /usr/local/bin/wpu-runner-entrypoint
ENTRYPOINT ["/usr/local/bin/wpu-runner-entrypoint"]
CMD ["bash"]
