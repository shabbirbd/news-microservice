import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import AWS from 'aws-sdk';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import os from 'os';
import fs from 'fs';
import FormData from 'form-data';


ffmpeg.setFfmpegPath('ffmpeg');
ffmpeg.setFfprobePath('ffprobe');


dotenv.config();

const TAVUS_API_KEY = process.env.TAVUS_API_KEY || "";
const AWS_REGION = "us-east-1";
const S3_BUCKET_NAME = "didvideoupload";
const AWS_ACCESS_KEY = process.env.AWS_ACCESS_KEY;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;



AWS.config.update({
  accessKeyId: AWS_ACCESS_KEY,
  secretAccessKey: AWS_SECRET_ACCESS_KEY,
  region: AWS_REGION
});

const s3 = new AWS.S3();


const app = express();

app.use(express.json());
app.use(cors());



const generateVideo = async (video: any, currentNews: any, text: any) => {
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
        body.background_source_url = video.bgUrl
      } else {
        body.background_url = video.bgUrl;
        body.background_source_url = ""
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


    const response = await fetch('https://tavusapi.com/v2/videos', options);

    if (response.ok) {
      const data = await response.json();
      const videoUrl = await getDetailedInfo(data.video_id, currentNews.userId);
      return videoUrl
    } else {
      const data = await response.json()
      console.log(data, 'failed data...')
      return ""
    }
  } catch (error: any) {
    console.log("error from generate video", error.message)
  }
};

const getDetailedInfo = async (videoId: string, userId: string) => {
  while (true) {
    try {
      console.log("Getting video details....")
      const jobResponse = await axios.get(`https://tavusapi.com/v2/videos/${videoId}?verbose=true`, {
        headers: {
          "x-api-key": TAVUS_API_KEY
        }
      });
      const jobDetails = await jobResponse.data;
      const jobStatus = jobDetails.status;

      if (jobStatus === 'ready') {
        console.log("Video ready...Getting video url...")
        const resultUrl = jobDetails.download_url;
        console.log('got the result updating user credit balance....')
        await updateCreditBalance(resultUrl, userId);
        const uploadedUrl = await uploadAndSave(resultUrl);

        console.log('Video URl...:', uploadedUrl);

        return uploadedUrl;
      } else if (jobStatus === 'error' || jobStatus === 'deleted') {
        console.log(`Job status is: ${jobStatus}, unable to create video...`);
        return "";
      } else {
        console.log(`Job status is ${jobStatus}. Checking again in 10 seconds.`);
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    } catch (error: any) {
      console.error('Error retrieving job details:', error.message);
      throw error;
    }
  }
};


const uploadAndSave = async (downloadUrl: string) => {
  try {
      const response = await axios.get(downloadUrl, { responseType: 'arraybuffer' });

      const fileContent = Buffer.from(response.data, 'binary');

      console.log('Preparing S3 upload params');
      const params = {
          Bucket: S3_BUCKET_NAME as string,
          Key: `videos/${uuidv4()}.mp4`,
          Body: fileContent,
          ContentType: 'video/mp4',
          ACL: 'public-read'
      };

      console.log('Starting S3 upload');
      const result = await s3.upload(params).promise();

      return result.Location;
  } catch (error) {
      console.error('Detailed error in uploadToS3:', error);
      throw error;
  }
};


const updateCreditBalance = async (downloadUrl: string, userId: string) => {
  const duration: any = await new Promise((resolve, reject) => {
    ffmpeg.ffprobe(downloadUrl, (err, metadata) => {
      if (err) {
        return reject(err);
      }
      const duration = metadata.format.duration;
      resolve(duration);
    });
  });
  const mainCost = duration * 0.0208
  console.log(duration, "duration......")
  const response = await fetch(`https://vendor.com/api/users/creditBalance`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ userId: userId, newCredit: mainCost })
  })

};



const transcodeVideo = async (url: string, targetResolution: string = '1920x1080'): Promise<string> => {
  const outputFilePath = path.join(os.tmpdir(), `${uuidv4()}.mp4`);
  return new Promise((resolve, reject) => {
    ffmpeg(url)
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
};


const mergeVideos = async (urls: string[]): Promise<string> => {
  const tempFile = path.join(os.tmpdir(), `${uuidv4()}.mp4`);
  const command = ffmpeg();

  // Transcode each video to a common format and resolution
  const transcodedFiles: string[] = [];
  for (const url of urls) {
    const transcodedFile = await transcodeVideo(url);
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
          fs.unlink(file, (err) => {
            if (err) {
              console.error(`Error deleting file ${file}:`, err);
            } else {
              console.log(`Deleted transcoded file: ${file}`);
            }
          });
        });
        resolve(tempFile);
      })
      .mergeToFile(tempFile, os.tmpdir());
  });
};


const extractAudio = async(videoUrl:string) => {
  return new Promise((resolve, reject) => {
    const outputFilePath = path.join(os.tmpdir(), `${uuidv4()}.mp3`);

    ffmpeg(videoUrl)
      .output(outputFilePath)
      .audioCodec('libmp3lame') // Set audio codec to MP3
      .noVideo() // Extract audio only
      .on('end', () => {
        console.log(`Audio file saved: ${outputFilePath}`);
        resolve(outputFilePath); // Return the path of the extracted audio file
      })
      .on('error', (err) => {
        console.error('Error during audio extraction:', err);
        reject(err);
      })
      .run();
  });
};


const  getAudioDuration = async (audioFilePath : string)=> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioFilePath, (err, metadata) => {
      if (err) {
        return reject(err);
      }
      // Duration is in seconds
      const duration = metadata.format.duration;
      resolve(duration);
    });
  });
}

const extractAudioAndGetTranscript = async (url: string, userId: string) =>{
  const filePath: any = await extractAudio(url);
  const apiUrl = 'https://api.openai.com/v1/audio/transcriptions';
  // Prepare form data to send audio file
  const formData = new FormData();
  formData.append('file', fs.createReadStream(filePath));
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'text');
  try {
    const response = await axios.post(apiUrl, formData, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        ...formData.getHeaders() // Include the form data headers
      }
    });

    const transcript = response.data;
    const duration: any = await getAudioDuration(filePath);
    console.log(duration, "duration....")
    
    const cost = (parseFloat(duration)/60) * 0.006;
    const costResponse = await fetch(`https://vendor.com/api/users/creditBalance`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ userId: userId, newCredit: cost })
    })
    await fs.unlink(filePath, ()=> {
      console.log("unlinked audio file...")
    });
    return transcript;
  } catch (err: any) {
    console.error('Error during transcription:', err);
    return ""
  }
};




const uploadToS3 = async (filePath: any): Promise<string> => {
  console.log('uploading to s3......')
  const fileContent = fs.readFileSync(filePath);
  const params = {
    Bucket: S3_BUCKET_NAME,
    Key: `videos/${path.basename(filePath)}`,
    Body: fileContent,
    ContentType: 'video/mp4',
    ACL: 'public-read'
  };

  const result = await s3.upload(params).promise();

   // Unlink the merged file after uploading
   fs.unlink(filePath, (err) => {
    if (err) {
      console.error(`Error deleting merged file ${filePath}:`, err);
    } else {
      console.log(`Deleted merged file: ${filePath}`);
    }
  });
  
  return result.Location;
};





const updateNews = async (newsId: string, newNews: any) => {
  const response = await fetch('https://vendor.com/api/news', {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ newsId: newsId, newNews: newNews })
  });
  if (response.ok) {
    console.log("news updated successfully....")
  }
  const data = await response.json();
  return data
}





app.post('/generateVideo', async (req, res) => {
  try {
    console.log('Current PATH:', process.env.PATH);
    const currentNews = await req.body;
    console.log(currentNews, "Starting the process....")

    // Step 1: Generate Video
    const videos = [...currentNews.videos];
    let results: any[] = [];

    for (const video of videos) {
      if(video.avatar){
        console.log(`Making video for: ${JSON.stringify(video)}`);
        const videoUrl: any = await generateVideo(video, currentNews, video.script);
        if (videoUrl.length < 1) {
          console.log('failed to create video for this step....')
        } else {
          console.log(`Success, VideoUrl: ${videoUrl}`);
          const constructedVideo = {...video, newsUrl: videoUrl};
          results = [...results, constructedVideo];
          console.log(`Done...`)
        }
      } else {
        const extractedTranscript = await extractAudioAndGetTranscript(video.newsUrl, currentNews.userId);
        const newVideo = {...video, script: extractedTranscript}
        results = [...results, {...newVideo}]
        console.log('its a raw video,..')
      }
    };


    const urls = results.map((item)=> item.newsUrl);
 
    const filePath = await mergeVideos(urls);

    const s3Url = await uploadToS3(filePath)

    console.log('margedUrl.....', s3Url)



    // Step 7: update course with result url....
    const newNews = {
      ...currentNews,
      videos: [...results],
      status: 'active',
      newsUrl: s3Url
    };

    const updatedCourse = await updateNews(currentNews._id, newNews)
    console.log("news updatesd...Exiting process.................................")
    res.status(200).json({ updatedCourse });

  } catch (error: any) {
    console.error('Error processing request:', error);
    res.status(500).json({ error: 'Failed to process request', details: error.message });
  }
});

const PORT = 5007;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`News video creation running on ${PORT}`);
});