# Satoshi quest whitelist lambda function

Project wa created from [this example](https://dev.to/calvinpak/how-to-read-write-google-sheets-with-react-193l). The tutorial also explains how to acquire all of the `.env` variables.


## Local development

Configure the `.env` file to be similar to the `.env.example`.

Start the project

    yarn install
    yarn start
    ./test.sh  // Launch test scripts. requires `curl`


## Deployment

    yarn compile

Manual deployment. No time to automate things. Copy the code from `dist/index.js` to your Google Cloud Function, set the `Runtime environments` to match the ones of your `.env` file here.
