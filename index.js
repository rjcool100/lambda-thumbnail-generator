var async = require("async");
var AWS = require("aws-sdk");
var gm = require("gm").subClass({
    imageMagick: true
});
var fs = require("fs");
var mktemp = require("mktemp");

var THUMB_KEY_PREFIX = "thumbnail",
    THUMB_REFERENCE_HEIGHT = process.env.REFERENCE_HEIGHT || 180,
    ALLOWED_FILETYPES = ['png', 'jpg', 'jpeg', 'bmp', 'tiff', 'pdf', 'gif'];

var utils = {
    decodeKey: function (key) {
        return decodeURIComponent(key).replace(/\+/g, ' ');
    }
};


var s3 = new AWS.S3();


function generateImage(bucket, srcKey, scalingfactor) {

    var n = srcKey.lastIndexOf("/");
    var basePath = "thumbnail-" + srcKey.substring(0, n + 1)
    var filename = srcKey.substring(n + 1);

    var dstKey = filename.replace(/\.\w+$/, ".jpg"),
        fileType = srcKey.match(/\.\w+$/);

    if (srcKey.indexOf(THUMB_KEY_PREFIX) === 0) {
        return;
    }

    if (fileType === null) {
        console.error("Invalid filetype found for key: " + srcKey);
        return;
    }

    fileType = fileType[0].substr(1);

    if (ALLOWED_FILETYPES.indexOf(fileType) === -1) {
        console.error("Filetype " + fileType + " not valid for thumbnail, exiting");
        return;
    }

    async.waterfall([

            function download(next) {
                //Download the image from S3
                s3.getObject({
                    Bucket: bucket,
                    Key: srcKey
                }, next);
            },

            function createThumbnail(response, next) {
                var temp_file, image;

                if (fileType === "pdf") {
                    temp_file = mktemp.createFileSync("/tmp/XXXXXXXXXX.pdf")
                    fs.writeFileSync(temp_file, response.Body);
                    image = gm(temp_file + "[0]");
                } else if (fileType === 'gif') {
                    temp_file = mktemp.createFileSync("/tmp/XXXXXXXXXX.gif")
                    fs.writeFileSync(temp_file, response.Body);
                    image = gm(temp_file + "[0]");
                } else {
                    image = gm(response.Body);
                }

                image.size(function (err, size) {
                    /*
                     * scalingFactor should be calculated to fit either the width or the height
                     * within 150x150 optimally, keeping the aspect ratio. Additionally, if the image 
                     * is smaller than 150px in both dimensions, keep the original image size and just 
                     * convert to png for the thumbnail's display
                     */

                    var height = THUMB_REFERENCE_HEIGHT * scalingfactor;
                    var width = height * (size.width / size.height);
                    width = Math.round(width * 100) / 100;
                    dstKey = THUMB_KEY_PREFIX + "_" + height + "_" + dstKey;
                    this.resize(width, height)
                        .toBuffer("jpg", function (err, buffer) {
                            if (temp_file) {
                                fs.unlinkSync(temp_file);
                            }

                            if (err) {
                                next(err);
                            } else {
                                next(null, response.contentType, buffer);
                            }
                        });
                });
            },

            function uploadThumbnail(contentType, data, next) {
                s3.putObject({
                    Bucket: bucket,
                    Key: basePath + dstKey,
                    Body: data,
                    ContentType: "image/jpg",
                    ACL: 'public-read',
                    Metadata: {
                        thumbnail: 'TRUE'
                    }
                }, next);
            }

        ],
        function (err) {
            if (err) {
                console.error(
                    "Unable to generate thumbnail for '" + bucket + "/" + srcKey + "'" +
                    " due to error: " + err
                );
            } else {
                console.log("Created thumbnail for '" + bucket + "/" + srcKey + "'");
            }
        });
}



exports.handler = function (event, context) {
    console.log(JSON.stringify(event));
    var bucket = event.Records[0].s3.bucket.name,
        srcKey = utils.decodeKey(event.Records[0].s3.object.key);
    generateImage(bucket, srcKey, 1);
    generateImage(bucket, srcKey, 1.5);
    generateImage(bucket, srcKey, 2);
};