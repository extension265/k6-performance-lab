# Newman + htmlextra on the same pinned Node 24 LTS base as the API.
# Built locally instead of pulled: no maintained public image ships current Newman with htmlextra
# (checked 2026-11-10), and keeping Newman out of package.json keeps its dependency tree out of
# the repo's npm audit / Dependabot surface.
FROM node:24.22.2-alpine3.24

RUN npm install --global --no-audit --no-fund newman@6.2.3 newman-reporter-htmlextra@1.23.1 \
 && npm cache clean --force

WORKDIR /etc/newman
USER node
ENTRYPOINT ["newman"]
