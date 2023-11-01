#!/usr/bin/sh


# echo "Valid call 1"
# # Valid call
# curl -X POST -H "Content-Type: application/json" \
#     -d '{"name": "name test", "company": "company test", "address": "address-test", "what": "I am a robot", "phone": "371 ...", "email": "test@blockvis.com", "value": "My added value"}' \
#     http://localhost:8080/

# echo "Valid call 2"
# # Valid call
# curl -X POST -H "Content-Type: application/json" \
#     -d '{"name": "name test", "company": "company test", "address": "address-test2", "what": "I am a robot", "phone": "371 ...", "email": "test@blockvis.com", "value": "My added value"}' \
#     http://localhost:8080/

# echo "Invalid call"
# # Invalid call (missing company field)
# curl -X POST -H "Content-Type: application/json" \
#     -d '{"name": "name test", "address": "address test", "what": "I am a robot", "phone": "371 ...", "email": "test@blockvis.com", "value": "My added value"}' \
#     http://localhost:8080/

echo "'stored on chain' gets set"
# Valid call
curl -X PATCH --cookie "whitelist-scret=secretssss" -H "Content-Type: application/json" \
    -d '{"rows": [2, 4]}' \
    http://localhost:8080/

# echo "Get all"
# curl --cookie "whitelist-scret=secretssss" http://localhost:8080

# echo "Get matching `address-test2`"
# curl http://localhost:8080/address-test2
