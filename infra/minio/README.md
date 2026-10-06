# Optional S3 storage and backup mirror

The upstream binary image tags used by this repository became unavailable. Both Compose files and
the restore drill now use local images built from the same official MinIO releases:

| Image | Official release | Source commit |
|---|---|---|
| `devon-minio:d0cada583fce` | `RELEASE.2025-04-08T15-41-24Z` | `d0cada583fce88f60cb276ddfb06f5cb16820069` |
| `devon-mc:e929f89ceeed` | `RELEASE.2025-04-08T15-39-49Z` | `e929f89ceeedc48a45611382be9882db0bf1921d` |

Build before enabling this optional profile or off-host mirroring:

```sh
bash infra/minio/build.sh
docker compose -f infra/docker-compose.yml --profile minio up -d --wait minio
```

The Dockerfile verifies each checked-out commit, builds with `go.sum` dependency verification, and
pins its Go and Alpine base images by digest. Runtime images include the upstream AGPL license.
The original source and complete corresponding build instructions are available here and at the
official repositories linked by each image's source/revision labels. MinIO is optional; installations
using local file storage do not need it. Building the images does not enable a production service.

Set `BACKUP_MIRROR_TO_MINIO=1` only after configuring and verifying the intended mirror endpoint.
The backup and restore scripts use the locally built client image. Stored S3 credentials alone do
not enable a restore probe. The scheduled restore workflow builds both images and tests a real
encrypted backup round trip through an isolated S3 server. `--skip-minio` explicitly skips that part.

When updating either upstream release, resolve its **dereferenced commit**, update all image
references together, rebuild, and run the restore drill. Do not use mutable `latest` tags as a
substitute for an unavailable image.

For the optional k3s manifest, load the built server image into each node before applying it:

```sh
docker save devon-minio:d0cada583fce | sudo k3s ctr images import -
```

The manifest uses `imagePullPolicy: Never` so a missing local image cannot accidentally resolve to
an unrelated public registry repository. Multi-node installations must import it on every node
that may schedule MinIO, or publish the image to their own trusted registry and pin that digest.
