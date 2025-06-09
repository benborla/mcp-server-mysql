import { execSync } from 'child_process';

const {
    GCLOUD_PROJECT_ID,
    ARTIFACT_REGISTRY_REPOSITORY,
    ARTIFACT_REGISTRY_DOCKER_IMAGE_NAME,
    ARTIFACT_REGISTRY_REGION
} = process.env;

if (!GCLOUD_PROJECT_ID || !ARTIFACT_REGISTRY_REPOSITORY || !ARTIFACT_REGISTRY_DOCKER_IMAGE_NAME || !ARTIFACT_REGISTRY_REGION) {
    console.error("Missing required environment variables.");
    process.exit(1);
}

const image = `${ARTIFACT_REGISTRY_REPOSITORY}/${ARTIFACT_REGISTRY_DOCKER_IMAGE_NAME}`;
try {
    // Build Docker image
    console.log(`Building Docker image: ${image}`);
    execSync(`docker build -t ${image} .`, { stdio: 'inherit' });

    // Push Docker image
    console.log(`Pushing Docker image: ${image}`);
    execSync(`docker push ${image}`, { stdio: 'inherit' });

    console.log("Image uploaded to GCP Artifact Registry successfully.");
} catch (err) {
    console.error("Deployment failed:", err);
    process.exit(1);
}