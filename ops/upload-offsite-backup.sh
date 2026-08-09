#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <completed-backup-directory>" >&2
  exit 1
fi

SOURCE="$1"
: "${OFFSITE_RCLONE_DESTINATION:?Set OFFSITE_RCLONE_DESTINATION to a configured rclone destination}"

command -v rclone >/dev/null 2>&1 || {
  echo "rclone is required for this provider-neutral off-server upload" >&2
  exit 1
}
if [ ! -d "$SOURCE" ] || [ ! -f "$SOURCE/checksums.sha256" ]; then
  echo "Source must be a completed checksummed production backup" >&2
  exit 1
fi
if find "$SOURCE" -maxdepth 1 -type f -name '.env*' | grep -q .; then
  echo "Backup contains an environment/secrets file; refusing upload" >&2
  exit 1
fi
(
  cd "$SOURCE"
  sha256sum -c checksums.sha256
)

backup_name="$(basename "$SOURCE")"
destination="${OFFSITE_RCLONE_DESTINATION%/}/$backup_name"
rclone copy "$SOURCE" "$destination" --checksum --immutable
rclone check "$SOURCE" "$destination" --checksum --one-way

echo "Off-server backup uploaded and checked: $destination"
echo "Encryption and retention remain properties of the configured rclone remote."
