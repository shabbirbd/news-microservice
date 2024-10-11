"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const axios_1 = __importDefault(require("axios"));
const uuid_1 = require("uuid");
const aws_sdk_1 = __importDefault(require("aws-sdk"));
const fluent_ffmpeg_1 = __importDefault(require("fluent-ffmpeg"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const fs_1 = __importDefault(require("fs"));
fluent_ffmpeg_1.default.setFfmpegPath('ffmpeg');
fluent_ffmpeg_1.default.setFfprobePath('ffprobe');
dotenv_1.default.config();
const TAVUS_API_KEY = process.env.TAVUS_API_KEY || "";
const AWS_REGION = "us-east-1";
const S3_BUCKET_NAME = "didvideoupload";
const AWS_ACCESS_KEY = process.env.AWS_ACCESS_KEY;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
aws_sdk_1.default.config.update({
    accessKeyId: AWS_ACCESS_KEY,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
    region: AWS_REGION
});
const s3 = new aws_sdk_1.default.S3();
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use((0, cors_1.default)());
const generateVideo = (video, currentNews, text) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const body = {
            script: text,
            replica_id: currentNews.selectedReplica.replica_id,
            video_name: video.title,
            background_url: "",
            background_source_url: "",
        };
        if (video.background) {
            if (video.bgType === 'upload') {
                body.background_url = '';
                body.background_source_url = video.bgUrl;
            }
            else {
                body.background_url = video.bgUrl;
                body.background_source_url = "";
            }
        }
        const options = {
            method: 'POST',
            headers: {
                'x-api-key': TAVUS_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        };
        const response = yield fetch('https://tavusapi.com/v2/videos', options);
        if (response.ok) {
            const data = yield response.json();
            const videoUrl = yield getDetailedInfo(data.video_id, currentNews.userId);
            return videoUrl;
        }
        else {
            const data = yield response.json();
            console.log(data, 'failed data...');
            return "";
        }
    }
    catch (error) {
        console.log("error from generate video", error.message);
    }
});
const getDetailedInfo = (videoId, userId) => __awaiter(void 0, void 0, void 0, function* () {
    while (true) {
        try {
            console.log("Getting video details....");
            const jobResponse = yield axios_1.default.get(`https://tavusapi.com/v2/videos/${videoId}?verbose=true`, {
                headers: {
                    "x-api-key": TAVUS_API_KEY
                }
            });
            const jobDetails = yield jobResponse.data;
            const jobStatus = jobDetails.status;
            if (jobStatus === 'ready') {
                console.log("Video ready...Getting video url...");
                const resultUrl = jobDetails.download_url;
                console.log('got the result updating user credit balance....');
                yield updateCreditBalance(resultUrl, userId);
                const uploadedUrl = yield uploadAndSave(resultUrl);
                console.log('Video URl...:', uploadedUrl);
                return uploadedUrl;
            }
            else if (jobStatus === 'error' || jobStatus === 'deleted') {
                console.log(`Job status is: ${jobStatus}, unable to create video...`);
                return "";
            }
            else {
                console.log(`Job status is ${jobStatus}. Checking again in 10 seconds.`);
                yield new Promise(resolve => setTimeout(resolve, 10000));
            }
        }
        catch (error) {
            console.error('Error retrieving job details:', error.message);
            throw error;
        }
    }
});
const uploadAndSave = (downloadUrl) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const response = yield axios_1.default.get(downloadUrl, { responseType: 'arraybuffer' });
        const fileContent = Buffer.from(response.data, 'binary');
        console.log('Preparing S3 upload params');
        const params = {
            Bucket: S3_BUCKET_NAME,
            Key: `videos/${(0, uuid_1.v4)()}.mp4`,
            Body: fileContent,
            ContentType: 'video/mp4',
            ACL: 'public-read'
        };
        console.log('Starting S3 upload');
        const result = yield s3.upload(params).promise();
        return result.Location;
    }
    catch (error) {
        console.error('Detailed error in uploadToS3:', error);
        throw error;
    }
});
const updateCreditBalance = (downloadUrl, userId) => __awaiter(void 0, void 0, void 0, function* () {
    const duration = yield new Promise((resolve, reject) => {
        fluent_ffmpeg_1.default.ffprobe(downloadUrl, (err, metadata) => {
            if (err) {
                return reject(err);
            }
            const duration = metadata.format.duration;
            resolve(duration);
        });
    });
    const mainCost = duration * 0.0208;
    console.log(duration, "duration......");
    const response = yield fetch(`https://vendor.com/api/users/creditBalance`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ userId: userId, newCredit: mainCost })
    });
});
const transcodeVideo = (url_1, ...args_1) => __awaiter(void 0, [url_1, ...args_1], void 0, function* (url, targetResolution = '1920x1080') {
    const outputFilePath = path_1.default.join(os_1.default.tmpdir(), `${(0, uuid_1.v4)()}.mp4`);
    return new Promise((resolve, reject) => {
        (0, fluent_ffmpeg_1.default)(url)
            .outputOptions('-c:v libx264') // Use H.264 codec
            .outputOptions('-preset fast') // Set encoding speed
            .outputOptions('-crf 23') // Set quality
            .outputOptions(`-vf scale=${targetResolution}`) // Set target resolution
            .outputOptions('-r 30') // Force constant frame rate (30 fps)
            .on('end', () => {
            console.log(`Transcoded video saved to ${outputFilePath}`);
            resolve(outputFilePath);
        })
            .on('error', (err) => {
            console.error('Error transcoding video:', err);
            reject(err);
        })
            .save(outputFilePath);
    });
});
const mergeVideos = (urls) => __awaiter(void 0, void 0, void 0, function* () {
    const tempFile = path_1.default.join(os_1.default.tmpdir(), `${(0, uuid_1.v4)()}.mp4`);
    const command = (0, fluent_ffmpeg_1.default)();
    // Transcode each video to a common format and resolution
    const transcodedFiles = [];
    for (const url of urls) {
        const transcodedFile = yield transcodeVideo(url);
        transcodedFiles.push(transcodedFile);
        command.input(transcodedFile);
    }
    return new Promise((resolve, reject) => {
        command
            .on('start', (commandLine) => {
            console.log('Spawned ffmpeg with command: ' + commandLine);
        })
            .on('error', (err) => {
            console.error('FFmpeg error:', err);
            reject(err);
        })
            .on('end', () => {
            console.log('FFmpeg process completed');
            // Unlink transcoded files after merging
            transcodedFiles.forEach((file) => {
                fs_1.default.unlink(file, (err) => {
                    if (err) {
                        console.error(`Error deleting file ${file}:`, err);
                    }
                    else {
                        console.log(`Deleted transcoded file: ${file}`);
                    }
                });
            });
            resolve(tempFile);
        })
            .mergeToFile(tempFile, os_1.default.tmpdir());
    });
});
const uploadToS3 = (filePath) => __awaiter(void 0, void 0, void 0, function* () {
    console.log('uploading to s3......');
    const fileContent = fs_1.default.readFileSync(filePath);
    const params = {
        Bucket: S3_BUCKET_NAME,
        Key: `videos/${path_1.default.basename(filePath)}`,
        Body: fileContent,
        ContentType: 'video/mp4',
        ACL: 'public-read'
    };
    const result = yield s3.upload(params).promise();
    // Unlink the merged file after uploading
    fs_1.default.unlink(filePath, (err) => {
        if (err) {
            console.error(`Error deleting merged file ${filePath}:`, err);
        }
        else {
            console.log(`Deleted merged file: ${filePath}`);
        }
    });
    return result.Location;
});
const updateCourse = (newsId, newNews) => __awaiter(void 0, void 0, void 0, function* () {
    const response = yield fetch('https://vendor.com/api/course', {
        method: "PUT",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ newsId: newsId, newNews: newNews })
    });
    if (response.ok) {
        console.log("Course updated successfully....");
    }
    const data = yield response.json();
    return data;
});
app.post('/generateVideo', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('Current PATH:', process.env.PATH);
        const currentNews = yield req.body;
        console.log(currentNews, "Starting the process....");
        // Step 1: Generate Video
        const videos = [...currentNews.videos];
        let results = [];
        for (const video of videos) {
            if (video.avatar) {
                console.log(`Making video for: ${JSON.stringify(video)}`);
                const videoUrl = yield generateVideo(video, currentNews, video.script);
                if (videoUrl.length < 1) {
                    console.log('failed to create video for this step....');
                }
                else {
                    console.log(`Success, VideoUrl: ${videoUrl}`);
                    const constructedVideo = Object.assign(Object.assign({}, video), { newsUrl: videoUrl });
                    results = [...results, constructedVideo];
                    console.log(`Done...`);
                    console.log(results, "newResult...");
                }
            }
            else {
                results = [...results, Object.assign({}, video)];
                console.log('its a raw video, new result is..', results);
            }
        }
        ;
        // const filePath = await mergeVideos(results);
        // const s3Url = await uploadToS3(filePath)
        // console.log('margedUrl.....', s3Url)
        // Step 7: update course with result url....
        const newNews = Object.assign(Object.assign({}, currentNews), { videos: [...results], status: 'active' });
        const updatedCourse = yield updateCourse(currentNews._id, newNews);
        console.log("news updatesd...Exiting process.................................");
        res.status(200).json({ updatedCourse });
    }
    catch (error) {
        console.error('Error processing request:', error);
        res.status(500).json({ error: 'Failed to process request', details: error.message });
    }
}));
const PORT = 5007;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`News video creation running on ${PORT}`);
});
// export default app;
// "@ffmpeg-installer/ffmpeg": "^1.1.0",
// "fluent-ffmpeg": "^2.1.3",
// "youtube-dl-exec": "^3.0.7",
