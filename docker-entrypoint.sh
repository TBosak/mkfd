#!/bin/bash
cp -r /backup-configs/* /configs/

# Execute the main command
exec "$@"