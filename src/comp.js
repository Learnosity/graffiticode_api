const assert = require('assert');
const {decodeID, encodeID} = require('./id.js');
const {dbQueryAsync, getItem, updateAST, updateOBJ} = require('./db.js');
const {delCache, getCache, setCache} = require('./cache.js');
const {pingLang, getCompilerVersion, getCompilerHost, getCompilerPort} = require('./lang.js');
const {parseJSON, cleanAndTrimObj, cleanAndTrimSrc} = require('./utils.js');
const parser = require('./parser.js');

const nilID = encodeID([0,0,0]);

function getData(auth, ids, refresh, resume) {
  if (encodeID(ids) === nilID || ids.length === 3 && +ids[2] === 0) {
    resume(null, {});
  } else {
    // Compile the tail.
    let id = encodeID(ids.slice(2));
    compileID(auth, id, {refresh: refresh}, resume);
  }
}

function getCode(ids, resume) {
  getItem(ids[1], (err, item) => {
    // if L113 there is no AST.
    if (item && item.ast) {
      let ast = typeof item.ast === "string" && JSON.parse(item.ast) || item.ast;
      resume(err, ast);
    } else {
      if (ids[0] !== 113) {
        console.log("No AST found: langID=" + ids[0] + " codeID=" + ids[1]);
        assert(item, "ERROR getCode() item not found: " + ids);
        let lang = item.language;
        let src = item.src.replace(/\\\\/g, "\\");
        parse(lang, src, (err, ast) => {
          updateAST(ids[1], ast, (err)=>{
            assert(!err);
          });
          // Don't wait for update.
          resume(err, ast);
        });
      } else {
        resume(err, {});
      }
    }
  });
}

function getLang(ids, resume) {
  let langID = ids[0];
  if (langID !== 0) {
    resume(null, "L" + langID);
  } else {
    // Get the language name from the item.
    getItem(ids[1], (err, item) => {
      resume(err, item.language);
    });
  }
}

function compileID(auth, id, options, resume) {
  let refresh = options.refresh;
  let dontSave = options.dontSave;
  if (id === nilID) {
    resume(null, {});
  } else {
    let ids = decodeID(id);
    if (refresh) {
      delCache(id, "data");
    }
    getCache(id, "data", (err, val) => {
      if (val) {
        // Got cached value. We're done.
        resume(err, val);
      } else {
        countView(ids[1]);  // Count every time code is used to compile a new item.
        getData(auth, ids, refresh, (err, data) => {
          getCode(ids, (err, code) => {
            if (err && err.length) {
              resume(err, null);
            } else {
              getLang(ids, (err, lang) => {
                if (err && err.length) {
                  resume(err, null);
                } else {
                  if (lang === "L113" && Object.keys(data).length === 0) {
                    // No need to recompile.
                    getItem(ids[1], (err, item) => {
                      if (err && err.length) {
                        resume(err, null);
                      } else {
                        try {
                          let obj = JSON.parse(item.obj);
                          setCache(lang, id, "data", obj);
                          resume(err, obj);
                        } catch (e) {
                          // Oops. Missing or invalid obj, so need to recompile after all.
                          // Let downstream compilers know they need to refresh
                          // any data used. Prefer true over false.
                          comp(auth, lang, code, data, options, (err, obj) => {
                            if (err) {
                              resume(err);
                            } else {
                              setCache(lang, id, "data", obj);
                              resume(null, obj);
                            }
                          });
                        }
                      }
                    });
                  } else {
                    if (lang && code) {
                      assert(code.root !== undefined, "Invalid code for item " + ids[1]);
                      // Let downstream compilers know they need to refresh
                      // any data used.
                      comp(auth, lang, code, data, options, (err, obj) => {
                        if (err) {
                          resume(err);
                        } else {
                          if (!dontSave) {
                            setCache(lang, id, "data", obj);
                            if (ids[2] === 0 && ids.length === 3) {
                              // If this is pure code, then update OBJ.
                              updateOBJ(ids[1], obj, (err)=>{ assert(!err) });
                            }
                          }
                          resume(null, obj);
                        }
                      });
                    } else {
                      // Error handling here.
                      console.log("ERROR compileID() ids=" + ids + " missing code");
                      resume(null, {});
                    }
                  }
                }
              });
            }
          });
        });
      }
    });
  }
}

function comp(auth, lang, code, data, options, resume) {
  pingLang(lang, pong => {
    if (pong) {
      // Compile ast to obj.
      var path = "/compile";
      var encodedData = JSON.stringify({
        "description": "graffiticode",
        "language": lang,
        "src": code,
        "data": data,
        "refresh": options.refresh,
        "config": config,
        "auth": auth,
      });
      var reqOptions = {
        host: getCompilerHost(lang, global.config),
        port: getCompilerPort(lang, global.config),
        path: path,
        method: 'GET',
        headers: {
          'Content-Type': 'text/plain',
          'Content-Length': Buffer.byteLength(encodedData),
        },
      };
      var req = protocol.request(reqOptions, function(res) {
        var data = "";
        res.on('data', function (chunk) {
          data += chunk;
        });
        res.on('end', function () {
          resume(null, parseJSON(data));
        });
        res.on('error', function (err) {
          console.log("[1] comp() ERROR " + err);
          resume(408);
        });
      });
      req.write(encodedData);
      req.end();
      req.on('error', function(err) {
        console.log("[2] comp() ERROR " + err);
        resume(408);
      });
    } else {
      resume(404);
    }
  });
}

function countView(id) {
  var query =
    "UPDATE pieces SET " +
    "views=views+1 " +
    "WHERE id='" + id + "'";
  dbQueryAsync(query, function (err) {
    if (err && err.length) {
      console.log("ERROR updateViews() err=" + err);
    }
  });
}

function parseID (id, options, resume) {
  let ids = decodeID(id);
  getItem(ids[1], (err, item) => {
    if (err && err.length) {
      resume(err, null);
    } else {
      // if L113 there is no AST.
      const lang = item.language;
      const src = item.src;
      if (src) {
        parse(lang, src, (err, ast) => {
          if (!ast || Object.keys(ast).length === 0) {
            console.log("NO AST for SRC " + src);
          }
          if (JSON.stringify(ast) !== JSON.stringify(item.ast)) {
            if (ids[1] && !options.dontSave) {
              console.log("Saving AST for id=" + id);
              updateAST(ids[1], ast, (err)=>{
                assert(!err);
                resume(err, ast);
              });
            } else {
              resume(err, ast);
            }
          } else {
            resume(err, ast);
          }
        });
      } else {
        resume(["ERROR no source. " + id]);
      }
    }
  });
}

function get(language, path, resume) {
  var data = [];
  var options = {
    host: getCompilerHost(language),
    port: getCompilerPort(language),
    path: "/" + path,
  };
  var req = protocol.get(options, function(res) {
    res.on("data", function (chunk) {
      data.push(chunk);
    }).on("end", function () {
      resume([], data.join(""));
    }).on("error", function () {
      resume(["ERROR"], "");
    });
  });
}

const lexiconCache = {};

function parse(lang, src, resume) {
  let lexicon;
  if ((lexicon = lexiconCache[lang])) {
    parser.parse(src, lexicon, resume);
  } else {
    get(lang, "lexicon.js", function (err, data) {
      const lstr = data.substring(data.indexOf("{"));
      lexicon = JSON.parse(lstr);
      lexiconCache[lang] = lexicon;
      parser.parse(src, lexicon, resume);
    });
  }
}

exports.compileID = compileID;