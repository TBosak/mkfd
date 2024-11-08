#!/bin/bash
cp -r /static/* /public/

# Execute the main command
exec "$@"