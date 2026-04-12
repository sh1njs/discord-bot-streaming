import axios from "axios"
import fs from "fs"
import path from "path"

async function ytdown(url, type = "video") {
    const { data } = await axios.post(
        "https://app.ytdown.to/proxy.php",
        new URLSearchParams({ url }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    )

    const api = data.api
    if (api?.status == "ERROR") {
        throw new Error(api.message)
    }

    const media = api?.mediaItems?.find(
        (m) => m.type.toLowerCase() === type.toLowerCase()
    )

    if (!media) {
        throw new Error("Media type not found")
    }

    while (true) {
        const { data: res } = await axios.get(media.mediaUrl)

        if (res?.error === "METADATA_NOT_FOUND") {
            throw new Error("Metadata not found")
        }

        if (
            res?.percent === "Completed" &&
            res?.fileUrl !== "In Processing..."
        ) {
            return {
                info: {
                    title: api.title,
                    desc: api.description,
                    thumbnail: api.imagePreviewUrl,
                    views: api.mediaStats?.viewsCount,
                    uploader: api.userInfo?.name,
                    quality: media.mediaQuality,
                    duration: media.mediaDuration,
                    extension: media.mediaExtension,
                    size: media.mediaFileSize
                },
                download: res.fileUrl
            }
        }

        await delay(5000)
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function sanitizeFilename(name) {
    return name
        .replace(/[\\/:*?"<>|]/g, "")
        .replace(/\s+/g, " ")
        .trim()
}

async function main() {
    const url = process.argv[2]

    if (!url) {
        console.log("Usage: node sc.js <youtube_link>")
        process.exit(1)
    }

    console.log("🔎 Retrieving metadata...")

    const res = await ytdown(url)

    const title = sanitizeFilename(res.info.title)
    const ext = res.info.extension.toLowerCase()

    const filepath = path.join(process.cwd(), `video.${ext}`)

    console.log("📥 Download:", title)

    const response = await axios.get(res.download, {
        responseType: "stream"
    })

    const writer = fs.createWriteStream(filepath)

    response.data.pipe(writer)

    writer.on("finish", () => {
        console.log("✅ Finished:", filepath)
    })

    writer.on("error", (err) => {
        console.error("❌ Error:", err)
    })
}

main().catch(console.error)