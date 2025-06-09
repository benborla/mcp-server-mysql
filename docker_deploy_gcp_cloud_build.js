import { execSync } from 'child_process';

const {
    GCLOUD_PROJECT_ID,
    ARTIFACT_REGISTRY_REPOSITORY,
    ARTIFACT_REGISTRY_DOCKER_IMAGE_NAME,
} = process.env;

const image = `${ARTIFACT_REGISTRY_REPOSITORY}/${ARTIFACT_REGISTRY_DOCKER_IMAGE_NAME}_cloud_build`;

const buildCmd = `gcloud builds submit --project=${GCLOUD_PROJECT_ID} --pack image=${image}`;
console.log(buildCmd);
let output = execSync(buildCmd, { stdio: 'inherit' });
console.log(output);

console.log("Done");

