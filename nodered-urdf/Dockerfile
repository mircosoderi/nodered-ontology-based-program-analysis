FROM nodered/node-red:4.1.3-22

# We need git at build time because the plugin depends on urdf via a git URL
USER root
RUN apk add --no-cache git

# Copy plugin source + entrypoint
COPY node-red-urdf-plugin /opt/node-red-urdf-plugin
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY nodered-default-settings.js /opt/nodered-default-settings.js
COPY app-ontology.jsonld /opt/urdf/app-ontology.jsonld

# Fix permissions so the node-red user can install dependencies in /opt/...
RUN chown -R node-red:node-red /opt/node-red-urdf-plugin \
    && chmod +x /usr/local/bin/docker-entrypoint.sh

# Install plugin dependencies at build time (so runtime doesn't need git)
USER node-red
WORKDIR /opt/node-red-urdf-plugin
RUN npm install --no-fund --no-audit

WORKDIR /usr/src/node-red

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

