# Node-RED Ontology-Based Program Analysis

## Overview

This repository ships:

 - A [lightweight ontology](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/app-ontology.rdf) to model Node-RED user applications
 - A folder to build a Docker image based on Node-RED, which includes a runtime and editor plugin, which are based on the [uRDF.js store](https://github.com/vcharpenay/uRDF.js) and the [eyeling N3 reasoner](https://github.com/eyereasoner/eyeling).
 - A few initial [experiments](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/experiments) to have a first intuition of the cost of the bundle in terms of CPU/RAM.
 - A few folders to build Docker images that can be used to generate JSON-LD representations of [GitHub issues](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/github-issues-to-jsonld), [Discourse forum posts](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/discourse-forum-to-jsonld), and [Node-RED flows](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/flows-json-to-jsonld).

## Try it out

Create a user-defined Docker network

    docker network create nodered-urdf-net

Clone this repository 

    git clone https://github.com/mircosoderi/nodered-ontology-based-program-analysis.git

Navigate to the folder of the main Docker image

    cd nodered-ontology-based-program-analysis/nodered-urdf

Build and run

    docker build -t nodered-urdf:4.1.3-22 .

    docker run -it --rm --network nodered-urdf-net \
    --name nodered-urdf -p 1880:1880 -v nodered_urdf_data:/data \
    -e NODE_RED_CREDENTIAL_SECRET="YOUR_SECRET_GOES_HERE" \ 
    nodered-urdf:4.1.3-22

Browse to http://localhost:1880/

Open the uRDF sidebar, located in the same area of the debug panel, configuration nodes panel, and so on.

Explore the available actions and configurations. In particular, have a look at the *Configuration* action to inspect the preloaded example rules, then to the *Reason* action to inspect what was inferred about the preloaded user application. The preloaded application includes a few example flows that are there to demonstrate the reasoning capabilities of the bundle.

Some rules only work if you upload the example GitHub issues, discourse forum posts, and library flows.

To upload the example GitHub issues:

    cd github-issues-to-jsonld
    
    docker build -t github-issues-to-jsonld .
    
    docker run --rm --network nodered-urdf-net \
      -v "$(pwd)/input:/app/input:ro" \
      -v "$(pwd)/output:/app/output" \
      -e NODERED_URDF="http://nodered-urdf:1880/" \
      github-issues-to-jsonld

To upload the example discourse forum posts:

    cd discourse-forum-to-jsonld
    
    docker build -t discourse-forum-to-jsonld .
    
    docker run --rm --network nodered-urdf-net \  
    -v "$(pwd)/input:/app/input:ro" \  
    -v "$(pwd)/output:/app/output" \  
    -e NODERED_URDF="http://nodered-urdf:1880/" \  
    discourse-forum-to-jsonld

To upload the example library flows:

    cd flows-json-to-jsonld
    
    docker build -t flows-json-to-jsonld .
    
    docker run --rm --network nodered-urdf-net \
      -v "$(pwd)/input:/app/input:ro" \
      -v "$(pwd)/output:/app/output" \
      -e NODERED_URDF="http://nodered-urdf:1880/" \
      -e FLOWS_URL="https://github.com/node-red/cookbook-flows" \
      flows-json-to-jsonld

Make a minor change on the application and redeploy to see the new triples inferred.

## Stay tuned

This is an ongoing effort. 

Software and documentation will progress together over time.

Thank you for your patience.

## Contact
E-mail me at mirco.soderi@gmail.com


