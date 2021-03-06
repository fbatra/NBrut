'use strict';

var config = require('../config.js'),
    logic = require('../logic/blog.js'),
    blog = require('../models/blog.js'),
    user = require('../models/user.js'),
    rest = require('../services/rest.js'),
    $ = require('../services/$.js'),
    pagedown = require('pagedown');

function findBlogInternal(req,res,done){
    var slug = logic.getSlug(req);

    logic.getStatus(function(){
        var slugTest = config.server.slugRegex,
            query = { slug: slug };

        if(logic.dormant){ // platform isn't configured at all
            if (req.url !== '/' || (slug !== config.server.slugHome && config.server.slugged)){
                return then('dormant-redirect');
            }
            return then('dormant');
        }

        if(!config.server.slugged){
            delete query.slug;
        }else if(slug === config.server.slugHome){
            return then('market');
        }else if(slugTest !== undefined && !slugTest.test(slug) && slug !== config.server.slugHome){
            return then('slug-redirect');
        }

        // the website is live and the blog might be user-defined (or available)
        return lookupBlog(req,query,then);
    });

    function then(status){
        req.slug = slug;
        req.blogStatus = status;
        done(status);
    }
}

function lookupBlog(req,query,then){
    blog.findOne(query).lean().exec(function(err, document){
        if(document !== null){ // this is the blog we're going to use
            user.findOne({ _id: document.owner }).lean().exec(function(err, user){
                if(err){
                    throw err;
                }
                req.blog = document;
                req.blogger = user;
                appendBlogInfo(req);
                return then('blog');
            });
        }else{ // allow the user to grab the blog
            if (req.url !== '/'){
                return then('available-redirect'); // not 301 because the slug can be claimed
            }
            return then('available');
        }
    });
}

function appendBlogInfo(req){
    var blog = req.blog,
        social = blog.social,
        blogger = req.blogger,
        user = req.user,
        email = social && social.email ? ' <' + social.email + '>' : '';

    blogger.meta = blogger.displayName + email;

    if (user){
        user.blogger = user._id.equals(blog.owner);
    }
    if (social){
        social.any = $.hasTruthyProperty(social);
        social.rssXml = config.server.hostSlug(blog.slug) + config.feed.relative;
    }
}

function findBlog(req,res){
    findBlogInternal(req,res,function(status){
        switch(status){
            case 'dormant-redirect': // not 301 because the slug can be awaken
                return res.redirect(config.server.host);
            case 'dormant':
                req.blog = 'dormant';
                return renderView(req,res);
            case 'slug-redirect': // this slug is forbidden, redirect to the default blog.
                return res.redirect(config.server.host + req.url, config.server.permanentRedirect ? 301 : 302);
            case 'market':
                req.blog = 'market';
                return renderView(req,res);
            case 'available-redirect':
                return res.redirect('/');
            case 'available':
                req.blog = 'available';
                return renderView(req,res);
            case 'blog':
                return renderView(req,res);
        }
    });
}

function renderView(req,res){
    var profile, view, locals,
        connected = req.user !== undefined,
        isBlogger = connected ? req.user.blogger : false;

    if(typeof req.blog === 'string'){
        profile = req.blog;
        view = profile + '/__layout.jade';
    }else{
        if(!connected){
            profile = 'anon';
            locals = {
                profile: 'anon',
                connected: false
            };
        }else{
            if(!isBlogger){
                profile = 'registered';
            }else{
                profile = 'blogger';
            }
            locals = {
                id: req.user._id,
                profile: profile,
                connected: true,
                blogger: isBlogger
            };

            var description = req.blog.description || 'Welcome to my personal blog!',
                html = (new pagedown.getSanitizingConverter()).makeHtml(description);

            req.blog.descriptionHtml = html;
        }
        view = 'slug/__' + profile + '.jade';
        locals.site = {
            title: req.blog.title,
            thumbnail: req.blog.thumbnail
        };
        res.locals.assetify.js.add('!function(a){a.locals=' + JSON.stringify(locals) + ';}(window);', 'before');
    }

    res.render(view, {
        profile: profile,
        slug: req.slug,
        blog: req.blog,
        blogger: req.blogger
    });
}

function hostValidation(req,res,next){
    var val = config.server.hostRegex;
    if (val !== undefined && !val.test(req.host)){
        res.redirect(config.server.host + req.url, 301);
        return;
    }

    // crucial: appends blog, blogStatus and blogger to the request.
    findBlogInternal(req,res,function(){
        next();
    });
}

module.exports = {
    hostValidation: hostValidation,
    get: findBlog
};