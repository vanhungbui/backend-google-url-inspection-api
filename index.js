const express = require( "express" );
const mysql = require('mysql');
const axios = require('axios');
const cors = require('cors')
const fs = require('fs');
const fsPromises = require('fs').promises;
const bodyParser = require('body-parser');  
const urlencodedParser = bodyParser.urlencoded({ extended: false })  

const app = express();
const port = 8080; // default port to listen

app.use(cors());
app.use(express.static('public'));
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(bodyParser.json());

let con = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "30061999",
    database: "deconst"
});

const fileNameIdsSource = 'item-ids-source.json';
const fileNameLastReadedIndex = 'last-readed-index.json';
const exeLength = 2000;

const siteUrl = 'https://xframe.io/';
const endpoint = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';

const saveItemIds = () => {
    con.connect((err) => {
        if (err) throw err;
        console.log("Connected!!!");
        const sql = 'SELECT id, title FROM `items` WHERE `status`= 2 ORDER BY published_at';
        con.query(sql, function(err, results) {
            if (err) throw err;
            const uniqueItemsMap = results.reduce((maps, item) => {
                if (!maps[item.title]) maps[item.title] = item.id;
                return maps;
            }, {});

            const uniqueItemIds = [];
            for (const [, value] of Object.entries(uniqueItemsMap)) {
                uniqueItemIds.push(value);
            }

            const jsonData = JSON.stringify(uniqueItemIds);
            fs.writeFile(fileNameIdsSource, jsonData, 'utf8', function(callbackRes) {
                console.log('callbackRes: ', callbackRes);
            });
            res.send('Save ' + uniqueItemIds.length + ' item ids');
        });
    });
}

const getData = async (itemId, accessToken) => {
    // Construct data object to send to API
    const body = {
      inspectionUrl: `https://xframe.io/photos/${itemId}`,
      siteUrl
    }

    try {
        const { data } = await axios({
            method: 'post',
            headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${accessToken}`
            },
            url: endpoint,
            data: body,
        })
        data.itemId = itemId;
        return data;
    } catch (error) {
        console.log('error: ', error);
        return { error, hasError: true };
    }


};

app.post("/", async (req, res) => {
    let result = null;
    const accessToken = req.body.accessToken;
    
    let nextReadedIndex = 0;
    let isQuotaExceeded = false;

    if (accessToken) {
        fs.readFile(fileNameIdsSource, async (err, data) => {
            if (err) throw err;

            const allItemIds = JSON.parse(data);

            const lastReadedIndexJson = await fsPromises.readFile(fileNameLastReadedIndex, 'utf8');
            const lastReadedIndex = lastReadedIndexJson ? JSON.parse(lastReadedIndexJson) || 0 : 0;
            nextReadedIndex = lastReadedIndex + exeLength;

            const exeItemIds = allItemIds.slice(lastReadedIndex, nextReadedIndex);
            let successCount = 0;

            const rawBatchResults = [];
            for (const itemId of exeItemIds) {
                const dataRes = await getData(itemId, accessToken);
                if (dataRes?.hasError) {
                    isQuotaExceeded = true;
                    result = dataRes.error;
                    break;
                } else {
                    successCount++;
                    rawBatchResults.push({ ...dataRes, itemId });
                }
            }
            nextReadedIndex = lastReadedIndex + successCount;
            if (rawBatchResults.length) {
                const today = new Date();
                const date = today.getDate();
                const month = today.getMonth() + 1;
                const year = today.getFullYear();
                const fileNameResult = `${year}-${month < 10 ? `0${month}` : month}-${date < 10 ? `0${date}` : date}-${lastReadedIndex}.json`;

                result = { rawBatchResults, fileNameResult };
                const jsonBatchResults = JSON.stringify(rawBatchResults);
                
                fs.writeFile(fileNameResult, jsonBatchResults, 'utf8', function(callbackRes) {
                    console.log(`callbackRes ${fileNameResult}: `, callbackRes);
                });

                fs.writeFile(fileNameLastReadedIndex, JSON.stringify(nextReadedIndex), 'utf8', function(callbackRes) {
                    console.log(`callbackRes ${fileNameLastReadedIndex}: `, callbackRes);
                });
            } else {
                console.log('Empty');
            }

            res.send(JSON.stringify({ nextReadedIndex, successCount, data: result }));
        });   
    }
});

app.listen( port, () => {
    console.log( `server started at http://localhost:${ port }` );
});