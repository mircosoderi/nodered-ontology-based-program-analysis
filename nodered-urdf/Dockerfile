FROM nodered/node-red:4.1.3-22

# ---------------------------------------------------------------------------
# Build-time system dependencies
# ---------------------------------------------------------------------------
# Git is required at build time because at least one Node-RED plugin dependency
# is resolved via a Git URL. Installing it here avoids needing Git at runtime.
USER root
RUN apk add --no-cache git

# ---------------------------------------------------------------------------
# Application assets and configuration
# ---------------------------------------------------------------------------
# - Node-RED custom plugin source (runtime + editor).
# - Custom entrypoint that performs initialization before Node-RED starts.
# - Default Node-RED settings file.
# - RDF ontology and rule definitions consumed by the runtime plugin.
#   These are copied into the image as defaults; the runtime may load them at startup depending on its configuration.
#
# All files are copied explicitly to fixed locations to make the container
# layout predictable and easier to reason about.
COPY node-red-urdf-plugin /opt/node-red-urdf-plugin
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY nodered-default-settings.js /opt/nodered-default-settings.js
COPY app-ontology.jsonld /opt/urdf/app-ontology.jsonld
COPY rules.jsonld /opt/urdf/rules.jsonld

# ---------------------------------------------------------------------------
# Permissions and executability
# ---------------------------------------------------------------------------
# The Node-RED runtime runs as the non-root `node-red` user.
# Ownership and permissions are adjusted so that:
# - npm can install dependencies into the plugin directory
# - the custom entrypoint can be executed by Docker
RUN chown -R node-red:node-red /opt/node-red-urdf-plugin \
    && chmod +x /usr/local/bin/docker-entrypoint.sh

# ---------------------------------------------------------------------------
# Plugin dependency installation (build-time)
# ---------------------------------------------------------------------------
# Plugin dependencies are installed during the image build so that:
# - the runtime container does not need Git
# - startup is faster and more deterministic
#
# npm audit and funding checks are disabled to reduce build noise and time.
USER node-red
WORKDIR /opt/node-red-urdf-plugin
RUN npm install --no-fund --no-audit

# ---------------------------------------------------------------------------
# Runtime working directory
# ---------------------------------------------------------------------------
# Reset the working directory to Node-RED's standard location before startup.
WORKDIR /usr/src/node-red

# ---------------------------------------------------------------------------
# Container entrypoint
# ---------------------------------------------------------------------------
# The custom entrypoint is responsible for any pre-start initialization
# (e.g., configuration injection, environment preparation) before launching
# the Node-RED runtime.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

